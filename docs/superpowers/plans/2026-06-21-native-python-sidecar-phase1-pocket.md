# Native Python Sidecar — Phase 1 (Pocket TTS plumbing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the native-local-inference architecture end-to-end on Electron by running Pocket TTS (zero-shot voice cloning) in a Python sidecar that the renderer drives over localhost WebSocket — spoken audio comes back through the existing `Int16@24kHz` contract.

**Architecture:** A Python sidecar process runs a localhost WebSocket server hosting the Pocket TTS ONNX pipeline (ported from the Node PoC's `pocketInferenceCore.ts`). Electron's main process spawns/supervises it via a new `NativeHostManager` and hands the renderer the port. A renderer-side `NativeTtsClient` (WS client) mirrors the slice of `TtsEngine` the dev playground needs, and a dev-only proto component exercises the full loop. Full `LocalInferenceClient` pipeline wiring, packaging, and on-demand download are **out of scope** (Phase 2 / packaging plan).

**Tech Stack:** Python 3.11 + `onnxruntime` + `numpy` + `websockets` + `sentencepiece` + `huggingface_hub` (sidecar); Node/Electron `child_process` (main); TypeScript + native `WebSocket` (renderer); pytest (Python tests); vitest (TS tests).

## Global Constraints

- **Electron-only.** All renderer code gated by `isElectron() && window.electron`. Extension/web untouched.
- **Audio contract (unchanged):** TTS returns `Float32` PCM @ **24000 Hz**; the renderer resamples to `Int16@24k` exactly as `TtsEngine` does today. `POCKET_SAMPLE_RATE = 24000`, `POCKET_SAMPLES_PER_FRAME = 1920` (80 ms), `POCKET_LATENT_DIM = 32`.
- **Pocket generation params (verbatim from PoC):** `lsdSteps = 1`, `maxFrames = 500`, `temperature = 0.7` (`std = sqrt(0.7)`), `EOS logit threshold = -4.0`, first decode chunk = 3 frames, normal decode chunk = 12 frames, `framesAfterEos = meta.model_recommended_frames_after_eos ?? 1`. **BOS-prepend is required** when `meta.insert_bos_before_voice` is true.
- **Pocket model bundle:** 5 int8 ONNX (`mimi_encoder`, `text_conditioner`, `flow_lm_main`, `flow_lm_flow`, `mimi_decoder`) + `bundle.json` + `tokenizer.model` + `bos_before_voice.npy`. Resolved via `huggingface_hub` from `KevinAHM/pocket-tts-web` (`repo_type="space"`, subfolder `onnx/english_2026-04`); `HF_HOME` pointed at the app data dir. English-only.
- **Threads:** cap onnxruntime `intra_op_num_threads` low (default 2; env `POCKET_NATIVE_THREADS`) — the per-frame `flow_lm_main` matmuls are tiny and all-cores oversubscribes (~halves throughput).
- **Dev runtime:** sidecar runs from a dev venv at `sidecar/.venv`; `NativeHostManager` resolves the interpreter from env `SOKUJI_SIDECAR_PYTHON` else `sidecar/.venv/bin/python` (`sidecar\\.venv\\Scripts\\python.exe` on win32). No bundled/signed binary in Phase 1.
- **tsc is not clean repo-wide** — the correctness gate is vitest/pytest, not `tsc`. Do not gate tasks on a clean `tsc`.
- **Source of truth for the port:** `origin/feat/pocket-tts-electron-native-poc:src/lib/local-inference/pocket/pocketInferenceCore.ts` and `electron/pocket-native-process.ts`. Read them before porting.

---

## File Structure

**Python sidecar (new subsystem, `sidecar/`):**
- `sidecar/requirements.txt` — pinned deps.
- `sidecar/sokuji_sidecar/__init__.py`
- `sidecar/sokuji_sidecar/__main__.py` — entrypoint: start WS server, print `{"port":N}` handshake.
- `sidecar/sokuji_sidecar/server.py` — `websockets` server, message envelope, request dispatch, per-stage routing.
- `sidecar/sokuji_sidecar/pocket_bundle.py` — bundle constants + `huggingface_hub` resolution + file loading.
- `sidecar/sokuji_sidecar/pocket_tokenizer.py` — sentencepiece wrapper.
- `sidecar/sokuji_sidecar/pocket_inference.py` — port of `pocketInferenceCore.ts` (sessions, state, encode/build/generate).
- `sidecar/sokuji_sidecar/pocket_engine.py` — stateful TTS engine (init/set_voice/generate) glued to the WS handlers.
- `sidecar/tests/…` — pytest.

**Electron main:**
- `electron/native-host-manager.js` — spawn/handshake/supervise/cleanup + `ipcMain.handle('native-host:*')`.
- Modify `electron/main.js` — require + init manager, register cleanup.
- Modify `electron/preload.js` — whitelist `native-host:start|stop|status`.
- Modify `vite.config.ts` — add `electron/native-host-manager.js` to the electron entry map.

**Renderer:**
- `src/lib/local-inference/native/nativeProtocol.ts` — shared WS message types + framing helpers.
- `src/lib/local-inference/native/NativeTtsClient.ts` — WS client mirroring the `TtsEngine` slice.
- `src/components/dev/NativeTtsProto.tsx` — dev-only proto (keyboard shortcut) to exercise the loop.
- Modify `src/App.tsx` — register the proto's keyboard shortcut (follow existing `Ctrl+Shift+*` proto pattern).

---

## Task 1: Sidecar scaffold + WS server + handshake

**Files:**
- Create: `sidecar/requirements.txt`, `sidecar/sokuji_sidecar/__init__.py`, `sidecar/sokuji_sidecar/__main__.py`, `sidecar/sokuji_sidecar/server.py`
- Test: `sidecar/tests/test_server_envelope.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `async def handle_message(state, raw) -> tuple[dict|None, bytes|None]` in `server.py` — pure dispatch returning `(json_reply, binary_reply)`. `async def serve(host="127.0.0.1", port=0) -> int` starts the server and returns the bound port. `__main__` prints `{"port": N}\n` to stdout once bound, then runs forever.

- [ ] **Step 1: Pin deps.** Create `sidecar/requirements.txt`:

```
onnxruntime==1.20.1
numpy==2.1.3
websockets==13.1
sentencepiece==0.2.0
huggingface_hub==0.26.2
```

- [ ] **Step 2: Write the failing test** `sidecar/tests/test_server_envelope.py`:

```python
import asyncio, json
from sokuji_sidecar.server import handle_message

def test_ping_returns_pong():
    state = {}
    reply, binary = asyncio.run(handle_message(state, json.dumps({"type": "ping", "id": 7})))
    assert reply == {"type": "pong", "id": 7}
    assert binary is None

def test_unknown_type_returns_error():
    state = {}
    reply, _ = asyncio.run(handle_message(state, json.dumps({"type": "nope", "id": 1})))
    assert reply["type"] == "error" and reply["id"] == 1
```

- [ ] **Step 3: Run it, expect failure.** Run: `cd sidecar && python -m pytest tests/test_server_envelope.py -q`. Expected: FAIL (`ModuleNotFoundError: sokuji_sidecar`).

- [ ] **Step 4: Implement `server.py`:**

```python
import asyncio, json
import websockets

async def handle_message(state, raw, binary_in=None):
    """Pure dispatch. Returns (json_reply_dict_or_None, binary_reply_bytes_or_None)."""
    msg = json.loads(raw)
    mtype = msg.get("type")
    mid = msg.get("id")
    if mtype == "ping":
        return {"type": "pong", "id": mid}, None
    # init / set_voice / generate are registered by later tasks via state["handlers"].
    handler = (state.get("handlers") or {}).get(mtype)
    if handler is None:
        return {"type": "error", "id": mid, "message": f"unknown message type: {mtype}"}, None
    return await handler(state, msg, binary_in)

async def _conn(state, ws):
    pending_binary = None
    async for raw in ws:
        if isinstance(raw, (bytes, bytearray)):
            pending_binary = bytes(raw)   # binary frame precedes its control message
            continue
        try:
            reply, binary = await handle_message(state, raw, pending_binary)
        except Exception as e:  # never drop the connection on a single bad request
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

- [ ] **Step 5: Implement `__main__.py`:**

```python
import asyncio, json, sys
from .server import serve

async def _run():
    state = {}
    port, server = await serve(state)
    print(json.dumps({"port": port}), flush=True)   # handshake line read by NativeHostManager
    await server.wait_closed()

def main():
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        sys.exit(0)

if __name__ == "__main__":
    main()
```

Create empty `sidecar/sokuji_sidecar/__init__.py`.

- [ ] **Step 6: Run tests, expect pass.** Run: `cd sidecar && python -m pytest tests/test_server_envelope.py -q`. Expected: 2 passed.

- [ ] **Step 7: Manual smoke.** Run: `cd sidecar && python -m sokuji_sidecar` — expect a `{"port": <N>}` line on stdout; Ctrl+C exits cleanly.

- [ ] **Step 8: Commit.**

```bash
git add sidecar/
git commit -m "feat(sidecar): WS server scaffold with handshake + ping dispatch"
```

---

## Task 2: Pocket bundle loader + tokenizer

**Files:**
- Create: `sidecar/sokuji_sidecar/pocket_bundle.py`, `sidecar/sokuji_sidecar/pocket_tokenizer.py`
- Test: `sidecar/tests/test_pocket_bundle.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pocket_bundle.MODEL_STEMS: dict[str,str]`, `SAMPLE_RATE=24000`, `SAMPLES_PER_FRAME=1920`, `LATENT_DIM=32`, `EOS_LOGIT_THRESHOLD=-4.0`, `DECODER_CHUNK_FRAMES=12`, `DEFAULT_LSD_STEPS=1`, `DEFAULT_MAX_FRAMES=500`.
  - `pocket_bundle.resolve_bundle_dir() -> str` (huggingface_hub) and `resolve_bundle_dir(local_dir)` passthrough for dev/tests.
  - `pocket_bundle.parse_npy_float32(path) -> np.ndarray` (1-D float32).
  - `pocket_tokenizer.PocketTokenizer(model_path).encode_ids(text) -> list[int]`.

- [ ] **Step 1: Write the failing test** `sidecar/tests/test_pocket_bundle.py`:

```python
import numpy as np, struct
from sokuji_sidecar import pocket_bundle as pb

def test_constants():
    assert pb.SAMPLE_RATE == 24000 and pb.LATENT_DIM == 32 and pb.DEFAULT_LSD_STEPS == 1
    assert set(pb.MODEL_STEMS) == {
        "mimiEncoder", "textConditioner", "flowLmMain", "flowLmFlow", "mimiDecoder"}

def test_parse_npy_float32(tmp_path):
    arr = np.arange(5, dtype=np.float32)
    p = tmp_path / "x.npy"; np.save(p, arr)
    out = pb.parse_npy_float32(str(p))
    assert out.dtype == np.float32 and np.allclose(out, arr)
```

- [ ] **Step 2: Run it, expect failure.** Run: `cd sidecar && python -m pytest tests/test_pocket_bundle.py -q`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `pocket_bundle.py`:**

```python
import numpy as np

MODEL_STEMS = {
    "mimiEncoder": "mimi_encoder_int8.onnx",
    "textConditioner": "text_conditioner_int8.onnx",
    "flowLmMain": "flow_lm_main_int8.onnx",
    "flowLmFlow": "flow_lm_flow_int8.onnx",
    "mimiDecoder": "mimi_decoder_int8.onnx",
}
TOKENIZER_FILE = "tokenizer.model"
METADATA_FILE = "bundle.json"
BOS_FILE = "bos_before_voice.npy"

SAMPLE_RATE = 24000
SAMPLES_PER_FRAME = 1920
LATENT_DIM = 32
EOS_LOGIT_THRESHOLD = -4.0
DECODER_CHUNK_FRAMES = 12
DEFAULT_LSD_STEPS = 1
DEFAULT_MAX_FRAMES = 500

HF_REPO = "KevinAHM/pocket-tts-web"
HF_SUBFOLDER = "onnx/english_2026-04"

def resolve_bundle_dir(local_dir: str | None = None) -> str:
    """Dev/tests: pass local_dir. Real path: snapshot_download the english bundle."""
    if local_dir:
        return local_dir
    from huggingface_hub import snapshot_download  # HF_HOME set by the caller (env)
    root = snapshot_download(
        repo_id=HF_REPO, repo_type="space",
        allow_patterns=[f"{HF_SUBFOLDER}/*"],
    )
    return f"{root}/{HF_SUBFOLDER}"

def parse_npy_float32(path: str) -> np.ndarray:
    return np.load(path).astype(np.float32).reshape(-1)
```

- [ ] **Step 4: Implement `pocket_tokenizer.py`:**

```python
import sentencepiece as spm

class PocketTokenizer:
    def __init__(self, model_path: str):
        self._sp = spm.SentencePieceProcessor()
        self._sp.Load(model_path)

    def encode_ids(self, text: str) -> list[int]:
        return self._sp.EncodeAsIds(text)
```

- [ ] **Step 5: Run tests, expect pass.** Run: `cd sidecar && python -m pytest tests/test_pocket_bundle.py -q`. Expected: 2 passed. (Tokenizer needs a real `tokenizer.model`; covered by the integration test in Task 3.)

- [ ] **Step 6: Commit.**

```bash
git add sidecar/sokuji_sidecar/pocket_bundle.py sidecar/sokuji_sidecar/pocket_tokenizer.py sidecar/tests/test_pocket_bundle.py
git commit -m "feat(sidecar): pocket bundle constants/loader + sentencepiece tokenizer"
```

---

## Task 3: Port the Pocket inference pipeline

This is a faithful Python/numpy port of `pocketInferenceCore.ts`. Read that file first. Tensors are numpy arrays; onnxruntime `session.run(output_names, feeds)` returns numpy.

**Files:**
- Create: `sidecar/sokuji_sidecar/pocket_inference.py`
- Test: `sidecar/tests/test_pocket_inference.py`

**Interfaces:**
- Consumes: `pocket_bundle` constants.
- Produces:
  - `load_sessions(model_dir, threads) -> dict[str, ort.InferenceSession]`
  - `init_state_from_manifest(manifest) -> dict[str, np.ndarray]`
  - `resample_to_24k(samples: np.ndarray, src_rate: int) -> np.ndarray`
  - `encode_reference(sessions, samples24k) -> np.ndarray` (voice emb `[1,T,cond]`)
  - `build_voice_conditioned_state(sessions, meta, voice_emb, bos) -> dict[str,np.ndarray]`
  - `generate(sessions, meta, text_embeddings, flow_state, lsd_steps, max_frames, rng) -> np.ndarray` (Float32 PCM @24k)

- [ ] **Step 1: Write the failing test** `sidecar/tests/test_pocket_inference.py` (unit pieces that need no model):

```python
import numpy as np
from sokuji_sidecar import pocket_inference as pi

def test_resample_passthrough_when_already_24k():
    x = np.arange(10, dtype=np.float32)
    assert np.array_equal(pi.resample_to_24k(x, 24000), x)

def test_resample_doubles_length_from_12k():
    x = np.zeros(100, dtype=np.float32)
    out = pi.resample_to_24k(x, 12000)
    assert abs(len(out) - 200) <= 1 and out.dtype == np.float32

def test_init_state_honors_fill_and_dtype():
    manifest = [
        {"input_name": "a", "output_name": "a_out", "dtype": "float32", "shape": [2], "fill": "nan"},
        {"input_name": "b", "output_name": "b_out", "dtype": "bool", "shape": [2]},
        {"input_name": "c", "output_name": "c_out", "dtype": "float32", "shape": [2], "fill": "ones"},
    ]
    st = pi.init_state_from_manifest(manifest)
    assert np.isnan(st["a"]).all()
    assert st["b"].dtype == np.bool_ and not st["b"].any()
    assert (st["c"] == 1).all()
```

- [ ] **Step 2: Run it, expect failure.** Run: `cd sidecar && python -m pytest tests/test_pocket_inference.py -q`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `pocket_inference.py`** (faithful port; dtype map `float32→np.float32`, `int64→np.int64`, `bool→np.bool_`):

```python
import numpy as np
import onnxruntime as ort
from . import pocket_bundle as pb

_DT = {"float32": np.float32, "int64": np.int64, "bool": np.bool_}

def load_sessions(model_dir: str, threads: int = 2) -> dict:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.log_severity_level = 3
    sessions = {}
    for sid, stem in pb.MODEL_STEMS.items():
        sessions[sid] = ort.InferenceSession(
            f"{model_dir}/{stem}", sess_options=opts, providers=["CPUExecutionProvider"])
    return sessions

def _filled(shape, dtype, fill):
    n = int(np.prod(shape)) if shape else 1
    if dtype == "int64":
        return np.zeros(shape, dtype=np.int64)
    if dtype == "bool":
        return np.zeros(shape, dtype=np.bool_)
    a = np.zeros(shape, dtype=np.float32)
    if fill == "nan": a[...] = np.nan
    elif fill == "ones": a[...] = 1.0
    return a

def init_state_from_manifest(manifest: list[dict]) -> dict:
    return {e["input_name"]: _filled(e["shape"], e["dtype"], e.get("fill")) for e in manifest}

def update_state_from_outputs(state: dict, result: dict, manifest: list[dict]) -> None:
    for e in manifest:
        if e["output_name"] in result:
            state[e["input_name"]] = result[e["output_name"]]

def resample_to_24k(samples: np.ndarray, src_rate: int) -> np.ndarray:
    if src_rate == pb.SAMPLE_RATE:
        return samples.astype(np.float32, copy=False)
    ratio = pb.SAMPLE_RATE / src_rate
    n = round(len(samples) * ratio)
    pos = np.arange(n) / ratio
    i0 = np.floor(pos).astype(np.int64)
    frac = (pos - i0).astype(np.float32)
    a = samples[np.clip(i0, 0, len(samples) - 1)]
    b = samples[np.clip(i0 + 1, 0, len(samples) - 1)]
    return (a + (b - a) * frac).astype(np.float32)

def _run(session, feeds: dict) -> dict:
    out = session.run(None, feeds)
    return dict(zip(session.get_outputs().__class__ and [o.name for o in session.get_outputs()], out))

def encode_reference(sessions, samples24k: np.ndarray) -> np.ndarray:
    audio = samples24k.reshape(1, 1, -1).astype(np.float32)
    res = _run(sessions["mimiEncoder"], {"audio": audio})
    return res[sessions["mimiEncoder"].get_outputs()[0].name]

def build_voice_conditioned_state(sessions, meta, voice_emb, bos) -> dict:
    latent_dim = meta.get("latent_dim", pb.LATENT_DIM)
    flow_state = init_state_from_manifest(meta["flow_lm_state_manifest"])
    empty_seq = np.zeros((1, 0, latent_dim), dtype=np.float32)
    voice_text_emb = voice_emb
    if meta.get("insert_bos_before_voice") and bos is not None:
        cond_dim = voice_emb.shape[2]
        t = voice_emb.shape[1]
        merged = np.empty((1, t + 1, cond_dim), dtype=np.float32)
        merged[0, 0, :] = bos[:cond_dim]
        merged[0, 1:, :] = voice_emb[0]
        voice_text_emb = merged
    feeds = {"sequence": empty_seq, "text_embeddings": voice_text_emb, **flow_state}
    res = _run(sessions["flowLmMain"], feeds)
    update_state_from_outputs(flow_state, res, meta["flow_lm_state_manifest"])
    return flow_state

def generate(sessions, meta, text_embeddings, flow_state_in, *, lsd_steps=1,
             max_frames=500, rng=None) -> np.ndarray:
    rng = rng or np.random.default_rng()
    latent_dim = meta.get("latent_dim", pb.LATENT_DIM)
    cond_dim = meta.get("conditioning_dim", text_embeddings.shape[2] if text_embeddings.ndim == 3 else 1024)
    frames_after_eos = meta.get("model_recommended_frames_after_eos", 1)
    std = float(np.sqrt(0.7))
    dt = 1.0 / lsd_steps
    st = [(np.array([[s / lsd_steps]], np.float32), np.array([[s / lsd_steps + dt]], np.float32))
          for s in range(lsd_steps)]

    mimi_state = init_state_from_manifest(meta["mimi_state_manifest"])
    flow_state = dict(flow_state_in)
    empty_seq = np.zeros((1, 0, latent_dim), np.float32)
    empty_text = np.zeros((1, 0, cond_dim), np.float32)

    cond_res = _run(sessions["flowLmMain"],
                    {"sequence": empty_seq, "text_embeddings": text_embeddings, **flow_state})
    update_state_from_outputs(flow_state, cond_res, meta["flow_lm_state_manifest"])

    pcm_chunks, chunk_latents = [], []
    decoded = 0
    first_audio = True
    current = np.full((1, 1, latent_dim), np.nan, np.float32)
    eos_step = None

    for step in range(max_frames):
        ar = _run(sessions["flowLmMain"],
                  {"sequence": current, "text_embeddings": empty_text, **flow_state})
        conditioning = ar["conditioning"]
        eos_logit = float(ar["eos_logit"].reshape(-1)[0])
        if eos_logit > pb.EOS_LOGIT_THRESHOLD and eos_step is None:
            eos_step = step
        should_stop = eos_step is not None and step >= eos_step + frames_after_eos

        latent = (rng.standard_normal(latent_dim).astype(np.float32) * std)
        for s_t, t_t in st:
            fr = _run(sessions["flowLmFlow"],
                      {"c": conditioning, "s": s_t, "t": t_t, "x": latent.reshape(1, latent_dim)})
            latent = latent + fr["flow_dir"].reshape(-1) * dt

        chunk_latents.append(latent.copy())
        current = latent.reshape(1, 1, latent_dim).astype(np.float32)
        update_state_from_outputs(flow_state, ar, meta["flow_lm_state_manifest"])

        pending = len(chunk_latents) - decoded
        size = 0
        if should_stop: size = pending
        elif first_audio and pending >= 3: size = 3
        elif pending >= pb.DECODER_CHUNK_FRAMES: size = pb.DECODER_CHUNK_FRAMES

        if size > 0:
            block = np.stack(chunk_latents[decoded:decoded + size]).reshape(1, size, latent_dim).astype(np.float32)
            dec = _run(sessions["mimiDecoder"], {"latent": block, **mimi_state})
            update_state_from_outputs(mimi_state, dec, meta["mimi_state_manifest"])
            pcm = dec[sessions["mimiDecoder"].get_outputs()[0].name].reshape(-1).astype(np.float32)
            pcm_chunks.append(pcm)
            decoded += size
            first_audio = False

        if should_stop:
            break

    return np.concatenate(pcm_chunks) if pcm_chunks else np.zeros(0, np.float32)
```

> Note: `_run` resolves output names from `session.get_outputs()`; the `flow_lm_main` manifest references `conditioning` / `eos_logit` and the state outputs by name, matching the bundle's `bundle.json` (same names the TS port reads). If a real bundle uses different feed key names than `sequence` / `text_embeddings` / `audio` / `latent` / `c`/`s`/`t`/`x`, adjust to the model's `get_inputs()` — verify against the downloaded bundle.

- [ ] **Step 4: Run unit tests, expect pass.** Run: `cd sidecar && python -m pytest tests/test_pocket_inference.py -q`. Expected: 3 passed.

- [ ] **Step 5: Add a model-gated integration test** appended to `tests/test_pocket_inference.py`:

```python
import os, json, pytest
from sokuji_sidecar import pocket_bundle as pb
from sokuji_sidecar.pocket_tokenizer import PocketTokenizer

@pytest.mark.skipif(not os.environ.get("POCKET_MODEL_DIR"), reason="set POCKET_MODEL_DIR to a local bundle")
def test_end_to_end_produces_audio():
    d = os.environ["POCKET_MODEL_DIR"]
    sessions = pi.load_sessions(d, threads=2)
    meta = json.load(open(f"{d}/{pb.METADATA_FILE}"))
    bos = pi.pb.parse_npy_float32(f"{d}/{pb.BOS_FILE}") if meta.get("insert_bos_before_voice") else None
    ref = np.zeros(24000, np.float32)  # 1s silence reference is enough to exercise the graph
    flow = pi.build_voice_conditioned_state(sessions, meta, pi.encode_reference(sessions, ref), bos)
    tok = PocketTokenizer(f"{d}/{pb.TOKENIZER_FILE}")
    ids = np.array(tok.encode_ids("hello world"), dtype=np.int64).reshape(1, -1)
    tc = sessions["textConditioner"].run(None, {"token_ids": ids})[0]
    out = pi.generate(sessions, meta, tc, flow, lsd_steps=1, max_frames=500,
                      rng=np.random.default_rng(0))
    assert out.dtype == np.float32 and len(out) > 24000  # >1s of audio
```

- [ ] **Step 6: Run the integration test against a local bundle.** Run: `cd sidecar && POCKET_MODEL_DIR=/path/to/pocket-tts-en python -m pytest tests/test_pocket_inference.py -q`. Expected: passes (audio longer than 1s). (Obtain the bundle via `scripts/download-pocket-tts-en.sh` from the PoC branch, or `python -c "from sokuji_sidecar.pocket_bundle import resolve_bundle_dir; print(resolve_bundle_dir())"`.)

- [ ] **Step 7: Commit.**

```bash
git add sidecar/sokuji_sidecar/pocket_inference.py sidecar/tests/test_pocket_inference.py
git commit -m "feat(sidecar): port Pocket TTS inference pipeline to python/onnxruntime"
```

---

## Task 4: Wire the Pocket engine into WS handlers

**Files:**
- Create: `sidecar/sokuji_sidecar/pocket_engine.py`
- Modify: `sidecar/sokuji_sidecar/server.py` (register handlers), `sidecar/sokuji_sidecar/__main__.py` (install handlers into state)
- Test: `sidecar/tests/test_pocket_engine.py`

**Interfaces:**
- Consumes: `pocket_inference`, `pocket_bundle`, `pocket_tokenizer`.
- Produces: WS messages — `{"type":"init","id","modelDir"?}` → `{"type":"ready","id","sampleRate":24000,"loadTimeMs"}`; `{"type":"set_voice","id","sampleRate"}` + preceding binary Float32 frame → `{"type":"ok","id"}`; `{"type":"generate","id","text","speed"?}` → binary Float32 PCM frame **then** `{"type":"result","id","sampleRate":24000,"generationTimeMs","samples":<len>}`.

- [ ] **Step 1: Write the failing test** `sidecar/tests/test_pocket_engine.py` (handlers with a fake engine so no model is needed):

```python
import asyncio, json, numpy as np
from sokuji_sidecar import server, pocket_engine

class FakeEngine:
    sample_rate = 24000
    def init(self, model_dir=None): return 12
    def set_voice(self, audio, sr): self.ref_len = len(audio)
    def generate(self, text, speed=1.0): return np.ones(48000, np.float32), 99

def make_state():
    st = {"engine": FakeEngine(), "handlers": {}}
    pocket_engine.register(st)
    return st

def test_init():
    st = make_state()
    reply, _ = asyncio.run(server.handle_message(st, json.dumps({"type":"init","id":1})))
    assert reply == {"type":"ready","id":1,"sampleRate":24000,"loadTimeMs":12}

def test_set_voice_reads_binary():
    st = make_state()
    audio = np.zeros(16000, np.float32).tobytes()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type":"set_voice","id":2,"sampleRate":16000}), binary_in=audio))
    assert reply == {"type":"ok","id":2} and st["engine"].ref_len == 16000

def test_generate_returns_binary_then_result():
    st = make_state()
    reply, binary = asyncio.run(server.handle_message(st, json.dumps({"type":"generate","id":3,"text":"hi"})))
    assert binary is not None and len(binary) == 48000 * 4   # float32
    assert reply["type"] == "result" and reply["id"] == 3 and reply["samples"] == 48000
```

- [ ] **Step 2: Run it, expect failure.** Run: `cd sidecar && python -m pytest tests/test_pocket_engine.py -q`. Expected: FAIL (`pocket_engine` missing).

- [ ] **Step 3: Implement `pocket_engine.py`:**

```python
import json, time
import numpy as np
from . import pocket_bundle as pb
from . import pocket_inference as pi
from .pocket_tokenizer import PocketTokenizer

class PocketEngine:
    sample_rate = pb.SAMPLE_RATE
    def __init__(self):
        self._sessions = None; self._meta = None; self._bos = None
        self._tok = None; self._flow = None
    def init(self, model_dir=None):
        import os
        t0 = time.time()
        d = pb.resolve_bundle_dir(model_dir)
        self._sessions = pi.load_sessions(d, int(os.environ.get("POCKET_NATIVE_THREADS", "2")))
        self._meta = json.load(open(f"{d}/{pb.METADATA_FILE}"))
        self._bos = pb.parse_npy_float32(f"{d}/{pb.BOS_FILE}") if self._meta.get("insert_bos_before_voice") else None
        self._tok = PocketTokenizer(f"{d}/{pb.TOKENIZER_FILE}")
        return int((time.time() - t0) * 1000)
    def set_voice(self, audio: np.ndarray, sr: int):
        ref = pi.resample_to_24k(audio, sr)
        emb = pi.encode_reference(self._sessions, ref)
        self._flow = pi.build_voice_conditioned_state(self._sessions, self._meta, emb, self._bos)
    def generate(self, text: str, speed: float = 1.0):
        if self._flow is None:
            raise RuntimeError("no reference voice set")
        t0 = time.time()
        ids = np.array(self._tok.encode_ids(text), np.int64).reshape(1, -1)
        tc = self._sessions["textConditioner"].run(None, {"token_ids": ids})[0]
        out = pi.generate(self._sessions, self._meta, tc, self._flow,
                          lsd_steps=pb.DEFAULT_LSD_STEPS, max_frames=pb.DEFAULT_MAX_FRAMES)
        return out, int((time.time() - t0) * 1000)

async def _h_init(state, msg, _b):
    ms = state["engine"].init(msg.get("modelDir"))
    return {"type": "ready", "id": msg.get("id"), "sampleRate": state["engine"].sample_rate, "loadTimeMs": ms}, None

async def _h_set_voice(state, msg, binary_in):
    audio = np.frombuffer(binary_in, dtype=np.float32)
    state["engine"].set_voice(audio, int(msg.get("sampleRate", pb.SAMPLE_RATE)))
    return {"type": "ok", "id": msg.get("id")}, None

async def _h_generate(state, msg, _b):
    samples, gen_ms = state["engine"].generate(msg.get("text", ""), float(msg.get("speed", 1.0)))
    pcm = np.ascontiguousarray(samples, dtype=np.float32).tobytes()
    reply = {"type": "result", "id": msg.get("id"), "sampleRate": state["engine"].sample_rate,
             "generationTimeMs": gen_ms, "samples": int(len(samples))}
    return reply, pcm

def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"init": _h_init, "set_voice": _h_set_voice, "generate": _h_generate})
```

- [ ] **Step 4: Install the real engine in `__main__.py`** — change `_run`:

```python
async def _run():
    from .pocket_engine import PocketEngine, register
    state = {"engine": PocketEngine()}
    register(state)
    port, server = await serve(state)
    print(json.dumps({"port": port}), flush=True)
    await server.wait_closed()
```

- [ ] **Step 5: Run tests, expect pass.** Run: `cd sidecar && python -m pytest tests/test_pocket_engine.py -q`. Expected: 3 passed.

- [ ] **Step 6: Commit.**

```bash
git add sidecar/sokuji_sidecar/pocket_engine.py sidecar/sokuji_sidecar/__main__.py sidecar/tests/test_pocket_engine.py
git commit -m "feat(sidecar): WS init/set_voice/generate handlers for Pocket TTS"
```

---

## Task 5: NativeHostManager (Electron main) — spawn, handshake, supervise

**Files:**
- Create: `electron/native-host-manager.js`
- Modify: `electron/main.js` (init + cleanup), `vite.config.ts` (entry)
- Test: `electron/native-host-manager.test.js` (pure helpers only)

**Interfaces:**
- Consumes: nothing.
- Produces: `module.exports = { resolvePython, parseHandshake, NativeHostManager }`.
  - `resolvePython(): string`
  - `parseHandshake(line: string): number | null`
  - `NativeHostManager` with `async start(): Promise<{port:number}>`, `stop(): void`, `status(): {running:boolean, port:number|null}`, and `registerIpc(ipcMain)` adding `native-host:start|stop|status`.

- [ ] **Step 1: Write the failing test** `electron/native-host-manager.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseHandshake, resolvePython } from './native-host-manager.js';

describe('parseHandshake', () => {
  it('extracts the bound port from the handshake JSON line', () => {
    expect(parseHandshake('{"port": 51791}')).toBe(51791);
  });
  it('returns null for non-handshake lines', () => {
    expect(parseHandshake('loading model…')).toBeNull();
    expect(parseHandshake('{"type":"ready"}')).toBeNull();
  });
});

describe('resolvePython', () => {
  it('honors SOKUJI_SIDECAR_PYTHON when set', () => {
    const prev = process.env.SOKUJI_SIDECAR_PYTHON;
    process.env.SOKUJI_SIDECAR_PYTHON = '/custom/python';
    expect(resolvePython()).toBe('/custom/python');
    process.env.SOKUJI_SIDECAR_PYTHON = prev;
  });
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npm run test -- electron/native-host-manager.test.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `electron/native-host-manager.js`:**

```javascript
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

function resolvePython() {
  if (process.env.SOKUJI_SIDECAR_PYTHON) return process.env.SOKUJI_SIDECAR_PYTHON;
  const venv = path.join(__dirname, '..', 'sidecar', '.venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

function parseHandshake(line) {
  try {
    const obj = JSON.parse(line);
    return typeof obj.port === 'number' ? obj.port : null;
  } catch { return null; }
}

class NativeHostManager {
  constructor() { this.proc = null; this.port = null; this._starting = null; }

  start() {
    if (this.port) return Promise.resolve({ port: this.port });
    if (this._starting) return this._starting;
    this._starting = new Promise((resolve, reject) => {
      const env = { ...process.env, HF_HOME: path.join(require('electron').app.getPath('userData'), 'hf-cache') };
      const child = spawn(resolvePython(), ['-m', 'sokuji_sidecar'], {
        cwd: path.join(__dirname, '..', 'sidecar'), env,
      });
      this.proc = child;
      const rl = readline.createInterface({ input: child.stdout });
      const onLine = (line) => {
        const port = parseHandshake(line);
        if (port) { this.port = port; rl.off('line', onLine); resolve({ port }); }
      };
      rl.on('line', onLine);
      child.stderr.on('data', (d) => console.error('[Sokuji] [native-host]', d.toString().trim()));
      child.on('exit', (code) => {
        console.warn('[Sokuji] [native-host] exited', code);
        this.proc = null; this.port = null; this._starting = null;
      });
      child.on('error', (err) => { this._starting = null; reject(err); });
      setTimeout(() => { if (!this.port) reject(new Error('native-host handshake timeout')); }, 30000);
    });
    return this._starting;
  }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch (_) {} }
    this.proc = null; this.port = null; this._starting = null;
  }

  status() { return { running: !!this.proc, port: this.port }; }

  registerIpc(ipcMain) {
    ipcMain.handle('native-host:start', async () => {
      try { return { ok: true, ...(await this.start()) }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    ipcMain.handle('native-host:stop', () => { this.stop(); return { ok: true }; });
    ipcMain.handle('native-host:status', () => ({ ok: true, ...this.status() }));
  }
}

module.exports = { resolvePython, parseHandshake, NativeHostManager };
```

- [ ] **Step 4: Run tests, expect pass.** Run: `npm run test -- electron/native-host-manager.test.js`. Expected: 3 passed.

- [ ] **Step 5: Wire into `electron/main.js`.** Near the other `ipcMain.handle` registrations and the audio-cleanup block (`main.js:408-458`), add:

```javascript
const { NativeHostManager } = require('./native-host-manager');
const nativeHost = new NativeHostManager();
nativeHost.registerIpc(ipcMain);
// fold into the existing cleanupAndExit path:
app.on('before-quit', () => nativeHost.stop());
app.on('will-quit', () => nativeHost.stop());
```

(Place the `stop()` calls alongside the existing `removeVirtualAudioDevices()` cleanup so SIGINT/SIGTERM/uncaughtException paths already covered at `main.js:408-458` also tear the sidecar down.)

- [ ] **Step 6: Add the entry to `vite.config.ts`.** In the electron `entry` map (around `vite.config.ts:99-109`), add `'native-host-manager': 'electron/native-host-manager.js'` so it compiles to `dist-electron/native-host-manager.js`.

- [ ] **Step 7: Commit.**

```bash
git add electron/native-host-manager.js electron/native-host-manager.test.js electron/main.js vite.config.ts
git commit -m "feat(electron): NativeHostManager spawns/supervises python sidecar"
```

---

## Task 6: Preload whitelist for native-host channels

**Files:**
- Modify: `electron/preload.js`
- Test: `electron/preload.native.test.js`

**Interfaces:**
- Consumes: the `native-host:*` channels from Task 5.
- Produces: `window.electron.invoke('native-host:start'|'native-host:stop'|'native-host:status')` reaches `ipcMain` (channels added to the `invoke` whitelist).

- [ ] **Step 1: Write the failing test** `electron/preload.native.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('preload invoke whitelist', () => {
  it('includes the native-host channels', () => {
    const src = readFileSync(join(__dirname, 'preload.js'), 'utf8');
    for (const ch of ['native-host:start', 'native-host:stop', 'native-host:status']) {
      expect(src).toContain(`'${ch}'`);
    }
  });
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npm run test -- electron/preload.native.test.js`. Expected: FAIL (channels absent).

- [ ] **Step 3: Add the channels** to the `validChannels` array in `electron/preload.js` (the `invoke` whitelist, around `preload.js:103-145`):

```javascript
      'native-host:start',
      'native-host:stop',
      'native-host:status',
```

- [ ] **Step 4: Run tests, expect pass.** Run: `npm run test -- electron/preload.native.test.js`. Expected: 1 passed.

- [ ] **Step 5: Commit.**

```bash
git add electron/preload.js electron/preload.native.test.js
git commit -m "feat(electron): whitelist native-host IPC channels in preload"
```

---

## Task 7: Renderer NativeTtsClient (WS) + protocol types

**Files:**
- Create: `src/lib/local-inference/native/nativeProtocol.ts`, `src/lib/local-inference/native/NativeTtsClient.ts`
- Test: `src/lib/local-inference/native/NativeTtsClient.test.ts`

**Interfaces:**
- Consumes: `window.electron.invoke('native-host:start')` → `{ok, port}`; the WS message contract from Task 4; `TtsResult` from `../engine/TtsEngine`.
- Produces: `class NativeTtsClient` with
  - `onStatus: ((m:string)=>void)|null`, `onError: ((e:string)=>void)|null`
  - `async init(): Promise<{ sampleRate:number; loadTimeMs:number }>`
  - `async setReferenceVoice(audio: Float32Array, sampleRate: number): Promise<void>`
  - `async generate(text: string, speed?: number): Promise<TtsResult>`
  - `dispose(): void`

- [ ] **Step 1: Write the failing test** `src/lib/local-inference/native/NativeTtsClient.test.ts` (drive the client against a fake `WebSocket`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeTtsClient } from './NativeTtsClient';

class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  sent: any[] = [];
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    this.sent.push(d);
    const msg = typeof d === 'string' ? JSON.parse(d) : null;
    if (msg?.type === 'init') queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({ type: 'ready', id: msg.id, sampleRate: 24000, loadTimeMs: 5 }) }));
    if (msg?.type === 'generate') {
      const pcm = new Float32Array([0.1, 0.2, 0.3]);
      queueMicrotask(() => this.onmessage?.({ data: pcm.buffer }));
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
        { type: 'result', id: msg.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 }) }));
    }
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeTtsClient', () => {
  it('connects on the started port and inits', async () => {
    const c = new NativeTtsClient();
    const r = await c.init();
    expect(r).toEqual({ sampleRate: 24000, loadTimeMs: 5 });
    expect(FakeWS.last.url).toBe('ws://127.0.0.1:9');
  });

  it('generate returns the binary PCM as a TtsResult', async () => {
    const c = new NativeTtsClient();
    await c.init();
    const res = await c.generate('hi');
    expect(res.sampleRate).toBe(24000);
    expect(Array.from(res.samples as Float32Array).map(x => +x.toFixed(1))).toEqual([0.1, 0.2, 0.3]);
  });
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npm run test -- src/lib/local-inference/native/NativeTtsClient.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `nativeProtocol.ts`:**

```typescript
// WS message contract between the renderer and the python sidecar (Phase 1: TTS only).
export interface ReadyMsg { type: 'ready'; id: number; sampleRate: number; loadTimeMs: number; }
export interface OkMsg { type: 'ok'; id: number; }
export interface ResultMsg { type: 'result'; id: number; sampleRate: number; generationTimeMs: number; samples: number; }
export interface ErrorMsg { type: 'error'; id?: number; message: string; }
export type ServerMsg = ReadyMsg | OkMsg | ResultMsg | ErrorMsg;
```

- [ ] **Step 4: Implement `NativeTtsClient.ts`:**

```typescript
import type { TtsResult } from '../engine/TtsEngine';
import type { ServerMsg } from './nativeProtocol';

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export class NativeTtsClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pendingJson = new Map<number, (m: ServerMsg) => void>();
  private pendingBinary = new Map<number, (b: ArrayBuffer) => void>();
  private lastBinary: ArrayBuffer | null = null;

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
    if (data instanceof ArrayBuffer) { this.lastBinary = data; return; }
    const msg = JSON.parse(data) as ServerMsg;
    if (msg.type === 'error') { this.onError?.(msg.message); if (msg.id) this.reject(msg.id, msg.message); return; }
    const id = (msg as any).id as number;
    if (msg.type === 'result') {
      const binResolve = this.pendingBinary.get(id);
      if (binResolve && this.lastBinary) { binResolve(this.lastBinary); this.lastBinary = null; this.pendingBinary.delete(id); }
    }
    this.pendingJson.get(id)?.(msg);
    this.pendingJson.delete(id);
  }

  private reject(id: number, message: string) {
    this.pendingJson.delete(id); this.pendingBinary.delete(id);
    this.onError?.(message);
  }

  private send(payload: object, expectBinary = false): Promise<{ msg: ServerMsg; binary?: ArrayBuffer }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let binary: ArrayBuffer | undefined;
      if (expectBinary) this.pendingBinary.set(id, (b) => { binary = b; });
      this.pendingJson.set(id, (msg) => {
        if (msg.type === 'error') return reject(new Error(msg.message));
        resolve({ msg, binary });
      });
      this.ws!.send(JSON.stringify({ ...payload, id }));
    });
  }

  async init(): Promise<{ sampleRate: number; loadTimeMs: number }> {
    await this.connect();
    this.onStatus?.('[native-tts] init…');
    const { msg } = await this.send({ type: 'init' });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { sampleRate: r.sampleRate, loadTimeMs: r.loadTimeMs };
  }

  async setReferenceVoice(audio: Float32Array, sampleRate: number): Promise<void> {
    this.ws!.send(audio.buffer);                         // binary frame precedes the control message
    await this.send({ type: 'set_voice', sampleRate });
  }

  async generate(text: string, speed = 1.0): Promise<TtsResult> {
    const { msg, binary } = await this.send({ type: 'generate', text, speed }, true);
    const r = msg as Extract<ServerMsg, { type: 'result' }>;
    return { samples: new Float32Array(binary!), sampleRate: r.sampleRate, generationTimeMs: r.generationTimeMs };
  }

  dispose(): void {
    try { this.ws?.close(); } catch (_) {}
    this.ws = null; this.pendingJson.clear(); this.pendingBinary.clear();
  }
}
```

- [ ] **Step 5: Run tests, expect pass.** Run: `npm run test -- src/lib/local-inference/native/NativeTtsClient.test.ts`. Expected: 2 passed.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/local-inference/native/
git commit -m "feat(renderer): NativeTtsClient WS client + protocol types"
```

---

## Task 8: Dev proto + end-to-end manual verification

**Files:**
- Create: `src/components/dev/NativeTtsProto.tsx`
- Modify: `src/App.tsx` (register `Ctrl+Shift+N` shortcut, following the existing proto pattern)
- Test: manual (end-to-end audio).

**Interfaces:**
- Consumes: `NativeTtsClient`, the app's `ModernAudioPlayer` (or a bare `AudioContext` for the proto).
- Produces: a dev overlay that loads a reference WAV, sends text, and plays the returned 24 kHz audio.

- [ ] **Step 1: Implement `src/components/dev/NativeTtsProto.tsx`** (minimal, self-contained; plays via `AudioContext`):

```tsx
import React, { useRef, useState } from 'react';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';

export const NativeTtsProto: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const client = useRef<NativeTtsClient | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [text, setText] = useState('Hello from the native python sidecar.');
  const [ref, setRef] = useState<Float32Array | null>(null);
  const push = (m: string) => setLog((l) => [...l, m]);

  const ensure = async () => {
    if (!client.current) {
      client.current = new NativeTtsClient();
      client.current.onStatus = push; client.current.onError = (e) => push('ERROR: ' + e);
      const r = await client.current.init(); push(`ready sr=${r.sampleRate} loadMs=${r.loadTimeMs}`);
    }
    return client.current;
  };

  const onRef = async (f: File) => {
    const buf = await f.arrayBuffer();
    const ac = new AudioContext();
    const audio = await ac.decodeAudioData(buf);
    setRef(audio.getChannelData(0).slice());
    push(`reference loaded: ${audio.length} samples @ ${audio.sampleRate}Hz`);
    const c = await ensure(); await c.setReferenceVoice(audio.getChannelData(0).slice(), audio.sampleRate);
    push('reference voice set');
  };

  const onGen = async () => {
    const c = await ensure();
    if (!ref) { push('load a reference clip first'); return; }
    const res = await c.generate(text);
    push(`generated ${res.samples.length} samples in ${res.generationTimeMs}ms`);
    const ac = new AudioContext();
    const buf = ac.createBuffer(1, res.samples.length, res.sampleRate);
    buf.copyToChannel(res.samples, 0);
    const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination); src.start();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1e1e1e', color: '#ddd', padding: 24, zIndex: 9999, overflow: 'auto' }}>
      <button onClick={onClose} style={{ float: 'right' }}>close</button>
      <h3>Native TTS Proto (python sidecar)</h3>
      <input type="file" accept="audio/*" onChange={(e) => e.target.files && onRef(e.target.files[0])} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', height: 60, marginTop: 8 }} />
      <button onClick={onGen} style={{ marginTop: 8 }}>generate + play</button>
      <pre style={{ marginTop: 12, fontSize: 12 }}>{log.join('\n')}</pre>
    </div>
  );
};
```

- [ ] **Step 2: Register the shortcut in `src/App.tsx`** following the existing `Ctrl+Shift+*` proto toggles (e.g. the ASR/TTS protos). Add state `const [showNativeTts, setShowNativeTts] = useState(false);`, an entry in the keydown handler for `e.ctrlKey && e.shiftKey && e.key === 'N'` toggling it, and render `{showNativeTts && <NativeTtsProto onClose={() => setShowNativeTts(false)} />}`.

- [ ] **Step 3: Create the dev venv.** Run:

```bash
cd sidecar && python3.11 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
```

- [ ] **Step 4: Obtain the Pocket bundle.** Either run the PoC branch's `scripts/download-pocket-tts-en.sh`, or let the sidecar resolve it on first `init` via `huggingface_hub` (requires network). Confirm the 5 onnx + `bundle.json` + `tokenizer.model` + `bos_before_voice.npy` exist.

- [ ] **Step 5: End-to-end manual verification.** Run: `npm run electron:dev`. In the app press `Ctrl+Shift+N`, load a short WAV reference clip, click "generate + play". Expected: status log shows `ready`, `reference voice set`, `generated N samples in <ms>`, and you **hear** the typed sentence in the reference voice. Confirm `generationTimeMs` implies > ~1× realtime (samples/24000 seconds of audio produced in less wall-clock time).

- [ ] **Step 6: Commit.**

```bash
git add src/components/dev/NativeTtsProto.tsx src/App.tsx
git commit -m "feat(dev): native python-sidecar TTS proto (Ctrl+Shift+N) — end-to-end Pocket"
```

---

## Self-Review

**Spec coverage (Phase 1 scope of `2026-06-21-native-python-sidecar-local-inference-design.md`):**
- Sidecar process + localhost WS server → Tasks 1, 4 (`server.py`, handlers).
- WS protocol (init/set_voice/generate, binary PCM) → Tasks 4, 7 (`nativeProtocol.ts` mirrors it).
- One native TTS channel (Pocket) → Tasks 2–4, 7.
- `NativeHostManager` spawn/handshake/supervise/cleanup → Task 5; IPC + preload whitelist → Tasks 5–6.
- Renderer client reusing the `TtsEngine` slice + audio contract (Float32@24k) → Task 7; end-to-end proof → Task 8.
- Reuse of `pocketInferenceCore` logic (re-hosted in Python) → Task 3.
- **Deliberately deferred (documented in this plan's intro/Non-Goals):** PyInstaller packaging, signing/notarization, on-demand download, GPU pack, and full `LocalInferenceClient`/provider/UI wiring → Phase 2 + a separate packaging plan. Phase 1 runs the sidecar from a dev venv.

**Placeholder scan:** every code step contains complete code; the one explicitly-flagged uncertainty (model feed key names in `_run`, Task 3 Step 3 note) is a verify-against-bundle instruction, not a code gap — the integration test (Task 3 Step 6) catches a mismatch.

**Type consistency:** `TtsResult { samples: Float32Array; sampleRate; generationTimeMs }` is consumed identically in Tasks 7–8. WS message shapes in `pocket_engine.py` (`ready`/`ok`/`result`/`error`) match `nativeProtocol.ts` and the `NativeTtsClient` parsing. `resolvePython`/`parseHandshake`/`NativeHostManager` names match between Task 5 implementation, its test, and the `native-host:start|stop|status` channels whitelisted in Task 6 and consumed in Task 7.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-21-native-python-sidecar-phase1-pocket.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task with review between tasks; fast iteration, isolated context per task.

**2. Inline Execution** — execute tasks in this session with checkpoints for review.

**Which approach?**
