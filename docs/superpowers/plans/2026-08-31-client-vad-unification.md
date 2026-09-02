# Client-VAD Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move speech segmentation for the local_native provider from the sidecar (audio.cpp silero) to the renderer (vad-web + silero_vad_v5.onnx), remove `sk_vad_*` from the native ABI, and switch the ASR wire leg to continuous PCM + client `vad_mark` events.

**Architecture:** The renderer runs a new `native-vad.worker.ts` (mirror of `zoom-vad.worker.ts`'s ORT + FrameProcessor loop, edge events only). `LocalNativeClient` feeds mic PCM to both the sidecar (unchanged binary frames) and the worker; the worker's edges become `{"type":"vad_mark","event":"start"|"end"|"cancel"}` control messages. The sidecar's `asr_engine.py` loses its VAD entirely: the offline path buffers audio between marks over a pre-roll ring; the streaming path keeps its always-stream/degrade architecture with marks (queued as sentinels, order-exact with audio) replacing the local VAD edges. `libsokuji_native` drops `sk_vad_*`, the bundled safetensors, and the VAD CTest; audio.cpp remains for TTS only.

**Tech Stack:** TypeScript/React renderer (vitest), Python sidecar (pytest), C++17 native library (CMake/CTest), `@ricky0123/vad-web`, onnxruntime-web WASM.

**Spec:** `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md` — **Amendment A1 (2026-08-31)** is the authority for this plan; on conflict with the spec body, A1 wins.

## Global Constraints

- English only in code, comments, tests, and commit messages (repo rule).
- TDD: each behavioral change lands with its test in the same task; run the test red first where the plan says so.
- The worktree guard rejects heredocs and complex pipelines in Bash. Write files with the Write/Edit tools; keep shell commands plain (env-var prefixes like `X=y cmd` are fine).
- Sidecar tests: run from the worktree root with `PYTHONPATH=<worktree>/sidecar` using the main checkout's venv interpreter `/home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest`. 4 pre-existing baseline failures exist in the full suite (3× pyopenjtalk, 1× bundles-workflow) — they are not yours.
- Renderer tests: `npx vitest run <paths>` from the worktree root. The worktree has a known dirty baseline on a FULL vitest run (~12 files); run targeted paths and compare failures against `main` before blaming your change.
- Native tests: CPU lane build at `native/build/cpu`; package tests run as `SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/stage python -m pytest native/python/tests -q` (the pytest `pythonpath` ini makes them import from source, not the installed wheel).
- Do not touch the browser/extension WebGPU lane workers (`whisper-webgpu`, `voxtral-*`, `zoom-vad`, engines) except to ADD the new worker file; `_shared/vad-thresholds.ts` is consumed, not modified.
- Wire contract: `wire_schema.json` (sidecar) and the `ServerMsg` union (`nativeProtocol.ts`) are pinned **bidirectionally** by `nativeProtocol.consistency.test.ts` — a message type must be added/removed on both sides in the SAME task (Task 3 does this for `speech_start`).
- `vad_mark` is inbound (client→sidecar) and is deliberately NOT added to `wire_schema.json` — that schema validates outbound messages only.
- Commit at the end of every task (conventional commits). Never push.

## Wire/API contract introduced by this plan (all tasks)

- Client→sidecar control message: `{"type": "vad_mark", "event": "start" | "end" | "cancel"}` — fire-and-forget, no `id`, no reply.
- `AsrEngine.mark(event: str) -> list[dict]` — offline mode: acts immediately and returns events to send; streaming mode: enqueues `("mark", event)` into `_audio_q` and returns `[]`.
- `asr_init` no longer carries `vadThreshold` / `vadMinSilenceDuration` / `vadMinSpeechDuration` (the handler must also not crash if a stale client still sends them — it simply never reads them).
- The sidecar never sends `speech_start` (removed from `wire_schema.json` and `ServerMsg` in Task 3).
- `NativeAsrClient.sendVadMark(event: 'start' | 'end' | 'cancel'): void`.
- Worker outbound messages: `{type:'ready'} | {type:'speech_start'} | {type:'speech_end'} | {type:'speech_cancel'} | {type:'error', message}` (worker-internal protocol, not the WS wire).
- `createNativeVadWorker(): Worker | null` at `src/services/clients/createNativeVadWorker.ts`.

---

### Task 1: Sidecar offline path — marks replace the VAD

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (offline half + handlers; leave the streaming half exactly as-is except where named)
- Modify: `sidecar/tests/test_asr_engine.py` (offline tests)

**Interfaces:**
- Consumes: existing `self._backend.transcribe(samples, language)`, `accel.resolve/load_measured/measure_rtf`.
- Produces: `AsrEngine.mark(event)` (contract above), `_h_vad_mark` handler registered as `"vad_mark"`, `AsrEngine.init(model_id, language, sample_rate, device, pin)` (no vad params), `feed()` that never emits `speech_start`.

**Design (offline mode):**
- A pre-roll ring (`RING_SAMPLES = int(0.7 * TARGET_RATE)`) receives downsampled audio only while NOT in speech; it absorbs the start-mark skew.
- `mark("start")`: seed the segment buffer with the ring's contents, record `_seg_start = max(0, _fed_total - ring_len)`, set `_in_speech`.
- While `_in_speech`, `feed()` appends to the segment buffer (and NOT to the ring). A 30 s backstop (`OFFLINE_CAP_SAMPLES = 30 * TARGET_RATE`) transcribes and restarts the segment in place if the client's end mark is lost (the client itself cuts at 20 s, so this should never fire in practice).
- `mark("end")`: transcribe the buffer, emit one `result`, clear the ring (so the next start cannot re-transcribe this utterance's tail).
- `mark("cancel")` (vad-web VADMisfire): drop the buffer, clear the ring, no output.
- `flush()`: same as an end mark when in speech; otherwise nothing. The 512-sample windowing (`self._buf`) is gone from the offline path — there is no VAD to window for.

- [ ] **Step 1: Rewrite the offline tests (red first)**

Replace `FakeAsr` and the offline tests at the top of `sidecar/tests/test_asr_engine.py` (`test_asr_init_sets_binary_router_and_replies_ready` through `test_asr_flush_drains`, plus `test_asr_init_forwards_vad_params` which is deleted) with:

```python
class FakeAsr:
    def __init__(self):
        self.marks = []

    def init(self, model_id=None, language="", sample_rate=24000, device="auto", **kw):
        self.sample_rate = sample_rate
        return 33

    def feed(self, int16_bytes):
        return []

    def mark(self, event):
        self.marks.append(event)
        if event == "end":
            return [{"type": "result", "text": "hello", "startSample": 0,
                     "durationMs": 1000, "recognitionTimeMs": 5}]
        return []

    def flush(self):
        return [{"type": "result", "text": "tail", "startSample": 0,
                 "durationMs": 100, "recognitionTimeMs": 1}]
```

and these tests (keep `make()`, `_FakeWS` as they are):

```python
def test_asr_init_sets_binary_router_and_replies_ready():
    st, conn = make()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_init", "id": 1, "language": "en"}), None, conn))
    assert reply == {"type": "ready", "id": 1, "loadTimeMs": 33}
    assert callable(conn.ctx.get("on_binary"))


def test_asr_init_ignores_stale_vad_params():
    """A stale client may still send the three vad* fields; init must not crash
    and must not try to forward them anywhere."""
    st, conn = make()
    reply, _ = asyncio.run(server.handle_message(st, json.dumps({
        "type": "asr_init", "id": 1, "model": "sense-voice",
        "vadThreshold": 0.3, "vadMinSilenceDuration": 1.4, "vadMinSpeechDuration": 0.4,
    }), None, conn))
    assert reply["type"] == "ready"


def test_vad_mark_routes_to_engine_and_pushes_results():
    st, conn = make()
    asyncio.run(server.handle_message(st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "vad_mark", "event": "start"}), None, conn))
    assert reply is None                       # fire-and-forget: no reply at all
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "vad_mark", "event": "end"}), None, conn))
    assert reply is None
    assert st["asr_engine"].marks == ["start", "end"]
    assert any('"hello"' in s for s in conn._ws.sent)   # the end-mark's result was pushed


def test_asr_flush_drains():
    st, conn = make()
    asyncio.run(server.handle_message(st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_flush", "id": 2}), None, conn))
    assert reply == {"type": "ok", "id": 2}
    assert any('"tail"' in s for s in conn._ws.sent)
```

Then add engine-level offline tests (place after `test_downsample_empty_bytes_with_non_default_rate`):

```python
def _offline_engine():
    """An AsrEngine in offline mode with a fake backend — no native lib, no model."""
    eng = asr_engine.AsrEngine()
    eng._src_rate = 16000
    eng._backend = _EchoBackend()
    return eng


class _EchoBackend:
    def __init__(self):
        self.calls = []          # the sample arrays transcribe() saw

    def transcribe(self, samples, language):
        from sokuji_sidecar.backends import AsrResult
        self.calls.append(np.asarray(samples))
        return AsrResult("seg-text")


def test_offline_segment_buffered_between_marks_and_transcribed_on_end():
    eng = _offline_engine()
    assert eng.feed(np.zeros(1600, np.int16).tobytes()) == []   # silence: no events ever
    assert eng.mark("start") == []
    eng.feed((np.ones(1600, np.int16) * 1000).tobytes())
    out = eng.mark("end")
    assert [m["type"] for m in out] == ["result"]
    assert out[0]["text"] == "seg-text"
    # the segment contains the fed speech plus the pre-roll ring (the earlier silence)
    assert len(eng._backend.calls) == 1
    assert len(eng._backend.calls[0]) >= 1600


def test_offline_preroll_ring_seeds_the_segment_and_is_capped():
    eng = _offline_engine()
    # feed 2s of pre-speech audio; ring must cap at 0.7s (11200 samples @16k)
    for _ in range(20):
        eng.feed(np.ones(1600, np.int16).tobytes())
    eng.mark("start")
    eng.mark("end")
    (seg,) = eng._backend.calls
    # The ring pops whole chunks: after capping it holds >= RING_SAMPLES and
    # < RING_SAMPLES + one chunk (1600 here).
    assert asr_engine.RING_SAMPLES <= len(seg) <= asr_engine.RING_SAMPLES + 1600


def test_offline_cancel_drops_the_segment():
    eng = _offline_engine()
    eng.mark("start")
    eng.feed(np.ones(1600, np.int16).tobytes())
    assert eng.mark("cancel") == []
    assert eng.mark("end") == []                # nothing left to transcribe
    assert eng._backend.calls == []


def test_offline_end_without_start_is_a_noop():
    eng = _offline_engine()
    assert eng.mark("end") == []
    assert eng._backend.calls == []


def test_offline_flush_finalizes_open_segment():
    eng = _offline_engine()
    eng.mark("start")
    eng.feed(np.ones(1600, np.int16).tobytes())
    out = eng.flush()
    assert [m["type"] for m in out] == ["result"]
    assert eng.flush() == []                    # idempotent once closed


def test_offline_ring_cleared_after_end_no_tail_duplication():
    eng = _offline_engine()
    eng.mark("start")
    eng.feed(np.ones(1600, np.int16).tobytes())
    eng.mark("end")
    eng.mark("start")                           # immediate restart
    eng.mark("end")
    assert len(eng._backend.calls) == 1         # second segment was empty -> no transcribe


def test_offline_backstop_cuts_a_runaway_segment():
    eng = _offline_engine()
    eng.mark("start")
    out = []
    chunk = np.ones(16000, np.int16).tobytes()  # 1s @16k src rate
    for _ in range(31):
        out += eng.feed(chunk)
    assert [m["type"] for m in out] == ["result"]   # the 30s backstop fired once
    out2 = eng.mark("end")                          # remainder still transcribes
    assert [m["type"] for m in out2] == ["result"]
```

Also rewrite `test_real_engine_transcribes_test_wav` to drive marks (the engine no longer segments by itself):

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_ASR_MODEL"),
                    reason="set SOKUJI_RUN_ASR_MODEL=1 (downloads model + test wav)")
def test_real_engine_transcribes_test_wav():
    from huggingface_hub import snapshot_download
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    pcm16k = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    ratio = 24000 / 16000
    n = round(len(pcm16k) * ratio)
    pos = np.arange(n) / ratio
    i0 = np.clip(np.floor(pos).astype(np.int64), 0, len(pcm16k) - 1)
    pcm24k = pcm16k[i0].astype(np.int16)

    eng = asr_engine.AsrEngine()
    eng.init()
    results = []
    results += [m["text"] for m in eng.mark("start") if m["type"] == "result"]
    for i in range(0, len(pcm24k), 4096):
        for m in eng.feed(pcm24k[i:i + 4096].tobytes()):
            if m["type"] == "result":
                results.append(m["text"])
    for m in eng.mark("end"):
        if m["type"] == "result":
            results.append(m["text"])
    text = " ".join(results).lower()
    assert "gold" in text or "tribal" in text, f"unexpected transcript: {results!r}"
```

Finally, in every OTHER test in this file that calls `eng.init(...)` or monkeypatches `_init_vad` for the OFFLINE path (e.g. `test_engine_init_uses_resolver`, `test_engine_init_measures_and_stores_rtf`, `test_offline_init_stores_memory_and_fallback_reason`, `test_engine_frees_old_model_on_reinit_and_close`, `test_conn_close_frees_asr_model`): remove the `_init_vad` monkeypatch lines and any vad kwargs — offline `init()` no longer touches a VAD. Streaming tests (`init_streaming`, `_vad_events`, `_vad_state` based) are NOT touched in this task — Task 2 owns them.

- [ ] **Step 2: Run the offline tests to verify they fail**

Run: `PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests/test_asr_engine.py -x -q -k "offline or vad_mark or asr_init or flush_drains or binary_router"`
Expected: FAIL (no `mark` method, init signature mismatch).

- [ ] **Step 3: Implement the offline rework in `asr_engine.py`**

Changes, precisely:

1. Module constants: keep `PREROLL_SAMPLES` (streaming uses it); add
```python
RING_SAMPLES = int(0.7 * TARGET_RATE)       # offline pre-roll (start-mark skew absorber)
OFFLINE_CAP_SAMPLES = 30 * TARGET_RATE      # backstop against a lost end mark (client cuts at 20s)
```
2. `__init__`: replace `self._vad = None` and `self._window/._buf` init with:
```python
self._backend = None
self._language = None
self.resolved = None
self._src_rate = SRC_RATE
self._streaming = False
# Offline (mark-driven) segmentation state:
self._in_speech = False
self._seg = []              # np.float32 chunks of the open segment
self._seg_len = 0
self._seg_start = 0         # first sample index of the open segment (16k, since init)
self._fed_total = 0         # every 16k sample ever fed since init
self._ring = []             # pre-roll ring, only fed while NOT in speech
self._ring_len = 0
# Streaming pre-roll ring (unchanged, used by the streaming half):
self._preroll = []
self._preroll_len = 0
```
3. Delete `_init_vad` ENTIRELY? **No — not yet.** The streaming half still calls it until Task 2. Instead: remove the `from .vad import NativeVad` usage only from the offline path by making `init()` not call `_init_vad` at all. Leave `_init_vad` itself in place for `init_streaming`.
4. New `init()`:
```python
def init(self, model_id=None, language="", sample_rate=SRC_RATE, device="auto", pin=None):
    from . import accel
    t0 = time.time()
    self.close()
    self._src_rate = int(sample_rate)
    self._streaming = False
    self._reset_offline()
    plans = accel.resolve(model_id or "sense-voice", override=device or "auto", pin=pin)
    self._backend, plan, notice, mem = accel.load_measured(plans, stage="asr")
    self._language = language or None
    rtf = accel.measure_rtf(self._backend, plan, model_id or "sense-voice", accel.probe())
    self.resolved = {"backend": plan.backend, "device": plan.device,
                     "computeType": plan.compute_type}
    if rtf is not None:
        self.resolved["rtf"] = round(rtf, 3)
    if mem is not None:
        self.resolved["memoryBytes"] = mem
    if notice:
        self.resolved["fallbackReason"] = notice
    import sys
    print(f"[sokuji-sidecar] ASR ready: model={model_id or 'sense-voice'} "
          f"backend={plan.backend} device={plan.device} compute={plan.compute_type}"
          + (f" rtf={rtf:.3f} (~{1 / rtf:.0f}x realtime)" if rtf else "")
          + f"  [requested device={device or 'auto'}]", file=sys.stderr, flush=True)
    return int((time.time() - t0) * 1000)
```
plus
```python
def _reset_offline(self):
    self._in_speech = False
    self._seg, self._seg_len, self._seg_start = [], 0, 0
    self._fed_total = 0
    self._ring, self._ring_len = [], 0
```
5. New `feed()` (segmentation removed; keeps returning a list for the `on_binary` loop):
```python
def feed(self, int16_bytes):
    x = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
    self._fed_total += len(x)
    if not self._in_speech:
        self._ring.append(x)
        self._ring_len += len(x)
        while len(self._ring) > 1 and self._ring_len - len(self._ring[0]) >= RING_SAMPLES:
            self._ring_len -= len(self._ring.pop(0))
        return []
    self._seg.append(x)
    self._seg_len += len(x)
    if self._seg_len >= OFFLINE_CAP_SAMPLES:
        # Lost end mark: transcribe what we have and keep going in-speech.
        out = self._cut()
        self._seg_start = self._fed_total
        return out
    return []
```
6. `mark()` + `_cut()`:
```python
def mark(self, event):
    """A client VAD edge. Offline: act now, return events to push. Streaming:
    enqueue a sentinel so the mark stays ordered against the queued audio."""
    if self._streaming:
        self._audio_q.put_nowait(("mark", event))
        return []
    if event == "start":
        self._seg = list(self._ring)
        self._seg_len = self._ring_len
        self._seg_start = max(0, self._fed_total - self._ring_len)
        self._ring, self._ring_len = [], 0
        self._in_speech = True
        return []
    if event == "end":
        if not self._in_speech:
            return []
        self._in_speech = False
        self._ring, self._ring_len = [], 0     # never re-seed with this utterance's tail
        return self._cut()
    if event == "cancel":
        self._in_speech = False
        self._seg, self._seg_len = [], 0
        self._ring, self._ring_len = [], 0
        return []
    return []

def _cut(self):
    """Transcribe the open segment buffer; emits at most one result."""
    if not self._seg:
        return []
    samples = np.concatenate(self._seg)
    self._seg, self._seg_len = [], 0
    t0 = time.time()
    text = self._backend.transcribe(samples, self._language).text
    if not text:
        return []
    return [{"type": "result", "text": text,
             "startSample": int(self._seg_start),
             "durationMs": int(len(samples) / TARGET_RATE * 1000),
             "recognitionTimeMs": int((time.time() - t0) * 1000)}]
```
7. `flush()`:
```python
def flush(self):
    if self._in_speech:
        return self.mark("end")
    return []
```
8. Delete `_drain()` (nothing calls it after this) and the `speech_start` emission in the old `feed()`.
9. `close()`: replace the `self._vad` close block with `self._reset_offline()`; keep everything else (stream abort, queue unblock, backend unload). Set `self._streaming = False`.
10. `_h_asr_init`: drop the three `msg.get("vad...")` reads and stop passing them:
```python
if is_streaming:
    eng.init_streaming(model, language, sample_rate, device=device, pin=pin)
    ...
else:
    ms = eng.init(model, language, sample_rate, device=device, pin=pin)
    ...
```
(`init_streaming` still has vad parameters with `None` defaults until Task 2 — calling with keywords skips them cleanly.)
11. New handler + registration:
```python
async def _h_vad_mark(state, msg, _b, conn=None):
    """Client VAD edge (fire-and-forget: no id, no reply). Push whatever the
    engine produced (an end mark can complete a segment -> one result)."""
    for out in state["asr_engine"].mark(msg.get("event", "")):
        if conn is not None:
            await conn.send(out)
    return None, None
```
and in `register`: `{"asr_init": _h_asr_init, "asr_flush": _h_asr_flush, "vad_mark": _h_vad_mark}`.
12. Update the class docstring: the engine is mark-driven; the client's vad-web worker owns segmentation.

- [ ] **Step 4: Run the offline + handler tests**

Run: `PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests/test_asr_engine.py -q`
Expected: offline/mark tests PASS. Streaming tests may still pass (untouched paths); if a streaming test fails ONLY because `_h_asr_init` no longer forwards vad params into `init_streaming`, adjust that test's fake signature minimally and note it for Task 2.

Also run the neighbors: `PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests/test_asr_backend.py sidecar/tests/test_server_conn.py sidecar/tests/test_server_envelope.py sidecar/tests/test_wire.py -q`
Expected: PASS (the engine still sends `speech_start` only from the streaming half, which is untouched).

- [ ] **Step 5: Commit**

`git add -A sidecar && git commit -m "feat(sidecar): mark-driven offline ASR segmentation (client VAD, Amendment A1)"`

---

### Task 2: Sidecar streaming path — mark sentinels; delete `vad.py`

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (streaming half)
- Delete: `sidecar/sokuji_sidecar/vad.py`, `sidecar/tests/test_vad.py`
- Modify: `sidecar/tests/test_asr_engine.py` (streaming tests)
- Modify: `sidecar/tests/test_native_models.py` (one stale comment), `sidecar/sokuji_sidecar/asr_backend.py` (two stale docstring phrases), `sidecar/requirements.txt` (one stale comment)

**Interfaces:**
- Consumes: `AsrEngine.mark()` from Task 1 (already enqueues `("mark", event)` when `self._streaming`).
- Produces: `init_streaming(model_id, language, sample_rate, device, pin)` (no vad params); `run_stream` dispatches `("mark", ev)` sentinels; no `speech_start` is ever sent by the engine after this task.

**Design (streaming mode):**
- `self._streaming = True` set in `init_streaming`; `self._in_speech` toggled by marks.
- **always_stream:** audio is fed continuously (unchanged). `_speech_samples` accumulates while `_in_speech`. A `("mark","end")` cuts via `_end_and_reopen` when the stream has seen speech; `("mark","start")` sets `_in_speech`; `("mark","cancel")` clears `_in_speech` without cutting. The 20 s run-on cap in `_drive_always` stays (backstop). The backpressure degrade keeps its logic with `self._in_speech` replacing `had_speech`.
- **per_utterance (degrade):** `("mark","start")` opens a stream and replays the pre-roll ring; audio buffers feed the stream only while `_in_speech`; `("mark","end")` finalizes (and can recover to always_stream when faster than realtime, as today); `("mark","cancel")` aborts without a result. A per-utterance 20 s backstop finalizes and immediately reopens (utterance continues) if the client's end mark is lost.
- The pre-roll ring is pushed only while NOT `_in_speech` and cleared on end/cancel (no tail re-play into the next utterance).
- `_vad_state`, `_vad_events`, `_init_vad`, `self._vad`, and the leftover `self._buf`/`self._window` state are deleted.

- [ ] **Step 1: Rewrite the streaming tests (red first)**

In `sidecar/tests/test_asr_engine.py`:

1. Find the `_streaming_engine(monkeypatch, fs, vad_segments=...)` helper (around line 440). Replace its scripted-VAD mechanism with scripted marks: delete the `vad_segments` parameter and its `_vad_events`/`_vad_state` monkeypatching; the engine under test gets marks by direct enqueue. Tests then read:

```python
def test_streaming_emits_partials_and_result_per_utterance(monkeypatch):
    fs = _FakeStream()
    eng = _streaming_engine(monkeypatch, fs)
    sent = []
    async def send(msg): sent.append(msg)
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", device="cuda")
    eng._mode = "per_utterance"
    eng.mark("start")
    eng.feed_stream(np.zeros(16000, np.int16).tobytes())
    eng.mark("end")
    asyncio.run(eng._drive_once(send))
    types_seen = [m["type"] for m in sent]
    assert "partial" in types_seen
    assert types_seen[-1] == "result"
    assert sent[-1]["text"] == "hello world"
    assert fs.ended is True
    assert "speech_start" not in types_seen     # the engine never sends speech_start
```

2. `test_streaming_emits_speech_start_partials_result` is renamed/rewritten as above (no speech_start).
3. `test_always_stream_cuts_on_endpoint_with_complete_tail` and `test_always_stream_endpoint_flushes_held_text_with_empty_pending`: replace the `monkeypatch.setattr(eng, "_vad_state", ...)` line by enqueueing the end mark and driving once, e.g.:
```python
    eng._streaming = True
    eng._in_speech = True
    import queue as _q; eng._audio_q = _q.Queue()
    eng._speech_samples = 8000
    eng.feed_stream(b"\x00\x00" * 1600)
    eng.mark("end")
    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_once(send))
```
(assertions unchanged: the held tail is in the final; the stream reopened; `_pending` cleared).
4. `test_always_stream_endpoint_with_no_text_does_not_cut`: end mark with `_speech_samples = 0` and `_in_speech = False` → no result, no reopen.
5. `test_always_stream_runon_cap_forces_cut`: keep — but set `eng._in_speech = True` instead of monkeypatching VAD so `_speech_samples` accumulates.
6. `test_silence_never_degrades_always_stream` / `test_backpressure_degrades_to_per_utterance`: replace VAD monkeypatches with `eng._in_speech = False` / `True` respectively; the degrade block reads `self._in_speech` now.
7. `test_gated_mode_replays_preroll_on_start`: drive with `eng.mark("start")` after pre-roll pushes (feed silence buffers first — ring only fills while not in speech).
8. `test_preroll_cleared_after_finalize`: after `mark("end")` + drive, assert `eng._preroll == []`.
9. `test_gated_fast_utterance_recovers_to_always`: marks instead of scripted VAD; same assertions.
10. `test_vad_state_reports_rising_and_falling_edges`: DELETE (the method is gone).
11. Add the cancel tests:
```python
def test_gated_cancel_aborts_without_result(monkeypatch):
    fs = _FakeStream()
    eng = _streaming_engine(monkeypatch, fs)
    sent = []
    async def send(msg): sent.append(msg)
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", device="cuda")
    eng._mode = "per_utterance"
    eng.mark("start")
    eng.feed_stream(np.zeros(1600, np.int16).tobytes())
    eng.mark("cancel")
    asyncio.run(eng._drive_once(send))
    assert [m for m in sent if m["type"] == "result"] == []
    assert fs.aborted_called is True            # add a flag to _FakeStream if absent
    assert eng._stream is None


def test_always_stream_cancel_does_not_cut(monkeypatch):
    # cancel clears _in_speech but never end()s the stream
    ...  # mirror test 4's harness: mark("start"), feed, mark("cancel"), drive
    # assert: no result, stream NOT reopened, eng._in_speech is False
```
(Write test 12 out in full in the test file — the harness is the same five lines as item 3 with `mark("cancel")` and `opened["n"] == 0` / `eng._in_speech is False` assertions.)
12. `test_asr_init_starts_streaming_task_for_streaming_backend` / `test_asr_init_offline_path_unchanged` / `test_resolves_to_streaming_real_method_threads_pin` / `test_streaming_init_sets_resolved_device_and_memory` / `test_conn_close_frees_streaming_asr_model` / `test_close_aborts_open_streaming_session`: update fake/real `init_streaming` signatures to `(model_id, language, sample_rate, device, pin)` and drop `_init_vad` monkeypatches.
13. Delete `sidecar/tests/test_vad.py` (whole file — the adapter it tests is deleted).

- [ ] **Step 2: Run to verify failures**

Run: `PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests/test_asr_engine.py -q`
Expected: streaming tests FAIL (marks not dispatched, signatures mismatch).

- [ ] **Step 3: Implement the streaming rework**

In `asr_engine.py`:

1. `init_streaming` signature: `(self, model_id=None, language="", sample_rate=SRC_RATE, device="auto", pin=None)`. Remove the `_init_vad` call; add `self._src_rate = int(sample_rate)`, `self._streaming = True`, `self._in_speech = False`. Everything else stays.
2. Delete `_init_vad`, `_vad_state`, `_vad_events`, and every reference to `self._vad` / `self._window` / the streaming use of `self._buf`. Delete the `from .vad import NativeVad` import.
3. `run_stream` loop body gains the sentinel dispatch (before the mode dispatch):
```python
if isinstance(data, tuple) and data and data[0] == "mark":
    ev = data[1]
    if self._mode == "always_stream":
        await self._mark_always(send, ev)
    else:
        await self._mark_utterance(send, ev)
    continue
```
The SAME dispatch goes into `_drive_once` (the test seam drains the same queue and
must handle `("mark", ev)` items identically — factor a small
`async def _dispatch(self, send, data)` used by both loops rather than duplicating).
4. New mark handlers:
```python
async def _mark_always(self, send, ev):
    if ev == "start":
        self._in_speech = True
        return
    if ev == "cancel":
        self._in_speech = False
        return
    if ev == "end":
        self._in_speech = False
        if self._stream is not None and self._speech_samples > 0:
            await self._end_and_reopen(send)

async def _mark_utterance(self, send, ev):
    if ev == "start":
        if self._stream is not None:            # stale stream from any source
            try:
                self._stream.abort()
            except Exception:
                pass
            self._stream = None
            self._partial_acc = []
        self._utt_start_sample = max(0, self._sample_cursor - self._preroll_len)
        self._stream = self._open_stream()
        pre = self._preroll_take()
        if pre is not None:
            self._stream.feed(pre)
        self._in_speech = True
        self._utt_fed = 0
        return
    if ev == "cancel":
        if self._stream is not None:
            try:
                self._stream.abort()
            except Exception:
                pass
            self._stream = None
            self._partial_acc = []
        self._in_speech = False
        self._preroll, self._preroll_len = [], 0
        return
    if ev == "end":
        self._in_speech = False
        if self._stream is None:
            return
        dur_ms, rec_ms = await self._finalize(send)
        self._preroll, self._preroll_len = [], 0
        if rec_ms < dur_ms:
            import sys
            print("[sokuji-sidecar] streaming caught up — back to always-stream mode",
                  file=sys.stderr, flush=True)
            self._mode = "always_stream"
            self._pending = ""
            self._speech_samples = 0
            self._stream = self._open_stream()
```
5. `_drive_utterance` becomes audio-only:
```python
async def _drive_utterance(self, send, int16_bytes):
    """Audio in gated mode. Marks arrive separately (see _mark_utterance); this
    only feeds the open stream while in speech and keeps the pre-roll ring warm
    while out of it. A 20s per-utterance backstop finalizes and reopens in place
    if the client's end mark is lost."""
    samples = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
    if self._in_speech and self._stream is not None:
        self._stream.feed(samples)
        self._utt_fed = getattr(self, "_utt_fed", 0) + len(samples)
        deltas = self._stream.drain()
        if deltas:
            self._partial_acc += deltas
            await send({"type": "partial", "text": "".join(self._partial_acc)})
        if self._utt_fed >= 20 * TARGET_RATE:   # lost end mark: cut, keep going
            await self._finalize(send)
            self._stream = self._open_stream()
            self._utt_fed = 0
    else:
        self._preroll_push(samples)
    self._sample_cursor += len(samples)
```
6. `_drive_always`: delete the `_vad_state` call, its try/except, and the `rising` send. Replace with:
```python
    had_speech = self._in_speech
    if had_speech:
        self._speech_samples += len(samples)
```
The run-on cut condition loses `falling` (marks own the endpoint now):
```python
    if self._speech_samples >= 20 * TARGET_RATE and self._speech_samples > 0:
        await self._end_and_reopen(send)
        return
```
The degrade block's `if had_speech:` branch stays, minus the `await send({"type": "speech_start"})` line (delete it — the engine never announces speech). Also delete the preroll-exclusion comment logic if any remains: `_preroll_push` in `_drive_always` stays as-is (the always-stream degrade replay is unchanged).
7. `run_stream`'s shutdown tail: unchanged.
8. Sweep: `grep -n "speech_start" sidecar/sokuji_sidecar/asr_engine.py` must return ZERO code lines (comments about the old behavior are removed too).
9. Delete `sidecar/sokuji_sidecar/vad.py`.
10. Stale-text touch-ups: `asr_backend.py` line ~6 "one AsrModel.run() per VAD segment" → "one AsrModel.run() per client-marked segment"; line ~100 "end()s at the VAD endpoint" → "end()s at the client's end mark". `requirements.txt` comment "# ASR + VAD (and, from slices 3-4, ...)" → "# ASR (and, from slices 3-4, translation + TTS) run in-process through the". `test_native_models.py` line ~356 comment "silero ships inside the sokuji_native wheel now — no separate VAD download." → "VAD runs in the renderer (spec Amendment A1) — no VAD artifact anywhere in the sidecar."

- [ ] **Step 4: Run the sidecar suite**

Run: `PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests -q`
Expected: PASS except the 4 known baseline failures. `speech_start` remains in `wire_schema.json` + `test_wire.py` until Task 3 — that is intentional (nothing sends it anymore; the schema entry is inert).

- [ ] **Step 5: Commit**

`git add -A sidecar && git commit -m "feat(sidecar): mark-driven streaming ASR; delete the sidecar VAD (Amendment A1)"`

---

### Task 3: Renderer protocol — `vad_mark` out, `speech_start` gone (both sides atomically)

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts` (remove `SpeechStartMsg`)
- Modify: `sidecar/sokuji_sidecar/wire_schema.json` (remove `"speech_start"` entry) and `sidecar/tests/test_wire.py` (line ~34)
- Modify: `src/lib/local-inference/native/NativeAsrClient.ts` and `NativeAsrClient.test.ts`
- Modify: `src/components/dev/NativeTtsProto.tsx` (drop the `onSpeechStart` line)
- Modify: `src/services/clients/LocalNativeClient.ts` (init call site only — the worker comes in Task 4)

**Interfaces:**
- Consumes: sidecar `vad_mark` handler (Tasks 1–2).
- Produces: `NativeAsrClient.init(language, modelId, sampleRate, device?, variant?)` (the `vad` parameter is GONE — device/variant shift left one position); `NativeAsrClient.sendVadMark(event)`; `ServerMsg` without `SpeechStartMsg`.

- [ ] **Step 1: Update the client tests (red first)**

In `NativeAsrClient.test.ts`:
1. The init test's call becomes `c.init('en', 'granite-speech-4.1-2b', 24000, 'cuda')` (4th positional arg is now `device`).
2. In `routes id-less push messages to their callbacks`: delete the `onSpeechStart` wiring, the `conn.emit({ type: 'speech_start' })` line and the `starts` assertions.
3. Add:
```ts
  it('sendVadMark() fires a vad_mark control message without an id', () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    c.sendVadMark('start');
    c.sendVadMark('end');
    expect(conn.sent).toEqual([
      { type: 'vad_mark', event: 'start' },
      { type: 'vad_mark', event: 'end' },
    ]);
  });
```
(Check `SidecarConnection.fake.ts`: if its `send()` does not record into `conn.sent`, record it there the same way `request()` does — but WITHOUT allocating an id.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/local-inference/native/NativeAsrClient.test.ts`
Expected: FAIL (`sendVadMark` missing; init arg mismatch).

- [ ] **Step 3: Implement**

1. `nativeProtocol.ts`: delete `export interface SpeechStartMsg { type: 'speech_start'; }` and remove `SpeechStartMsg` from the `ServerMsg` union.
2. `wire_schema.json`: delete the `"speech_start"` line (mind the trailing comma of the previous entry).
3. `test_wire.py` line ~34: replace `wire.validate_outbound({"type": "speech_start"})` with `wire.validate_outbound({"type": "partial", "text": "hi"})` and update its trailing comment.
4. `NativeAsrClient.ts`:
   - delete `onSpeechStart` and the `speech_start` branch in `onPush`;
   - `init` signature: `async init(language = '', modelId?: string, sampleRate = 24000, device?: string, variant?: string)` — remove the `vad` parameter and the three `vadX` fields from the request payload;
   - add:
```ts
  /** Forward a client-VAD edge to the sidecar (fire-and-forget; interleaves
   *  with the binary PCM in connection order). */
  sendVadMark(event: 'start' | 'end' | 'cancel'): void {
    this.conn.send({ type: 'vad_mark', event });
  }
```
5. `NativeTtsProto.tsx`: delete the `aclient.current.onSpeechStart = () => push('· speech_start');` line.
6. `LocalNativeClient.ts` `initAsr`: the call becomes
```ts
        const res = await this.asr.init(config.sourceLanguage, config.asrModelId, 24000,
          config.asrDevice, config.asrVariant);
```
(the `vadThreshold`/`minSilence`/`minSpeech` object is deleted here; Task 4 routes those knobs into the worker).

- [ ] **Step 4: Run the affected suites**

Run: `npx vitest run src/lib/local-inference/native src/services/clients/LocalNativeClient.test.ts src/components/dev 2>/dev/null` (drop paths that do not exist; `LocalNativeClient.test.ts` may assert the old init payload — update those expectations here).
Expected: PASS, including `nativeProtocol.consistency.test.ts` (both sides dropped `speech_start` together).

Run: `PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests/test_wire.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add -A src sidecar && git commit -m "feat(protocol): vad_mark control message; speech_start push removed on both sides"`

---

### Task 4: `native-vad.worker.ts` + LocalNativeClient wiring

**Files:**
- Create: `src/lib/local-inference/workers/native-vad.worker.ts`
- Create: `src/services/clients/createNativeVadWorker.ts`
- Modify: `src/services/clients/LocalNativeClient.ts` (+ its test file)

**Interfaces:**
- Consumes: `NativeAsrClient.sendVadMark` (Task 3), `resolveVadThresholds` from `src/lib/local-inference/workers/_shared/vad-thresholds.ts`, `VadWebConfig` from `src/lib/local-inference/types.ts`.
- Produces: worker inbound `{type:'init', ortWasmBaseUrl?, vadModelUrl?, vadConfig?: VadWebConfig} | {type:'audio', pcm: Int16Array, sampleRate: number} | {type:'flush'} | {type:'dispose'}`; worker outbound `{type:'ready'} | {type:'speech_start'} | {type:'speech_end'} | {type:'speech_cancel'} | {type:'error', message: string}`.

- [ ] **Step 1: Write the worker**

`src/lib/local-inference/workers/native-vad.worker.ts` — copy `zoom-vad.worker.ts` VERBATIM as the base, then apply exactly these deltas (the file header comment must describe the new role):

1. Header comment:
```ts
/**
 * Client-side Silero VAD edge detector for the local_native (sidecar) provider.
 * Receives PCM16 frames, resamples to 16 kHz, runs Silero VAD, and posts EDGE
 * EVENTS ONLY back to the main thread — speech_start / speech_end /
 * speech_cancel. No utterance audio leaves this worker: the sidecar receives
 * the continuous PCM directly and segments on the client's vad_mark events
 * (spec Amendment A1). Mirrors zoom-vad.worker.ts's ORT + FrameProcessor loop.
 */
```
2. Inbound/outbound types:
```ts
type WorkerInbound =
  | { type: 'init'; ortWasmBaseUrl?: string; vadModelUrl?: string; vadConfig?: VadWebConfig }
  | { type: 'audio'; pcm: Int16Array; sampleRate: number }
  | { type: 'flush' }
  | { type: 'dispose' };

type WorkerOutbound =
  | { type: 'ready' }
  | { type: 'speech_start' }
  | { type: 'speech_end' }
  | { type: 'speech_cancel' }
  | { type: 'error'; message: string };
```
with `import type { VadWebConfig } from '../types';` and `import { resolveVadThresholds } from './_shared/vad-thresholds';`.
3. `initVad(vadConfig?: VadWebConfig, vadModelUrl?: string)` maps the knobs exactly as `voxtral-webgpu.worker.ts` does:
```ts
  const { positive: positiveSpeechThreshold, negative: negativeSpeechThreshold } =
    resolveVadThresholds(vadConfig);
  const redemptionMs = (vadConfig?.minSilenceDuration ?? 1.4) * 1000;
  const minSpeechMs = (vadConfig?.minSpeechDuration ?? 0.4) * 1000;
  const preSpeechPadMs = (vadConfig?.preSpeechPadDuration ?? 0.8) * 1000;
  maxSpeechFrames = Math.ceil(((vadConfig?.maxSpeechDuration ?? 20) * 1000) / VAD_FRAME_MS);
```
and passes them into the `FrameProcessor` options (`submitUserSpeechOnPause: false` stays).
4. Event mapping — replace `emitUtterance` with edge posts everywhere:
   - `Message.SpeechStart` → `post({ type: 'speech_start' })`
   - `Message.SpeechEnd` → `post({ type: 'speech_end' })` (drop the audio; no transferables)
   - `Message.VADMisfire` → `post({ type: 'speech_cancel' })`
   - the max-speech cap block and `flush()` call `frameProcessor.endSegment(...)` as in the zoom worker, mapping the resulting events through the SAME three-way mapping (a too-short forced segment yields VADMisfire → `speech_cancel`).
5. `handleMessage`'s `init` case passes `msg.vadConfig` into `initVad`.
Everything else (resampler, 512-frame loop, message queue serialization, dispose) is byte-identical to the zoom worker.

- [ ] **Step 2: Write the factory**

`src/services/clients/createNativeVadWorker.ts`:
```ts
/** Isolated factory so LocalNativeClient can be unit-tested with the worker stubbed. */
export function createNativeVadWorker(): Worker | null {
  return new Worker(
    new URL('../../lib/local-inference/workers/native-vad.worker.ts', import.meta.url),
    { type: 'module' },
  );
}
```

- [ ] **Step 3: LocalNativeClient tests (red first)**

Open `src/services/clients/LocalNativeClient.test.ts` and study how it constructs the client with fake `deps` (`asr`/`translate`/`tts`). Add a fake worker:

```ts
class FakeVadWorker {
  posted: any[] = [];
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  postMessage(m: any) {
    this.posted.push(m);
    if (m.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
  }
  terminate() { this.posted.push({ type: '__terminated' }); }
  emit(data: any) { this.onmessage?.({ data }); }
}
```

and tests (adapt the connect fixture the file already uses — same config, fakes for asr/translate/tts):

```ts
it('connect() boots the VAD worker with the session vad knobs', async () => { /* connect, then: */
  const init = worker.posted.find((m) => m.type === 'init');
  expect(init.vadConfig).toEqual({ threshold: cfg.vadThreshold,
    minSilenceDuration: cfg.vadMinSilenceDuration, minSpeechDuration: cfg.vadMinSpeechDuration });
});

it('worker edges become vad_mark sends (start/end/cancel)', async () => { /* connect, then: */
  worker.emit({ type: 'speech_start' });
  worker.emit({ type: 'speech_end' });
  worker.emit({ type: 'speech_cancel' });
  expect(fakeAsr.marks).toEqual(['start', 'end', 'cancel']);   // fakeAsr records sendVadMark calls
});

it('appendInputAudio() feeds both the sidecar and the worker', async () => { /* connect, then: */
  const pcm = new Int16Array(2400);
  client.appendInputAudio(pcm);
  expect(fakeAsr.fed).toHaveLength(1);
  expect(worker.posted.some((m) => m.type === 'audio' && m.pcm === pcm)).toBe(true);
});

it('createResponse() flushes the worker before the sidecar flush', async () => { /* connect, then: */
  client.createResponse();
  expect(worker.posted.some((m) => m.type === 'flush')).toBe(true);
  expect(fakeAsr.flushed).toBe(true);
});

it('disconnect() disposes and terminates the worker', async () => { /* connect, then: */
  await client.disconnect();
  expect(worker.posted.some((m) => m.type === 'dispose')).toBe(true);
  expect(worker.posted.some((m) => m.type === '__terminated')).toBe(true);
});

it('a null worker factory (test env) still connects', async () => {
  // deps.vadWorker: () => null — connect resolves, appendInputAudio does not throw
});
```

Extend the file's fake asr with `marks: string[]`, `sendVadMark(e) { this.marks.push(e); }`, `fed: Int16Array[]`, `flushed`.

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement the wiring in `LocalNativeClient.ts`**

1. `import { createNativeVadWorker } from './createNativeVadWorker';`
2. `Deps` gains `vadWorker?: () => Worker | null;`; constructor stores `this.vadWorkerFactory = deps.vadWorker ?? createNativeVadWorker;`; field `private vadWorker: Worker | null = null;`.
3. In `connect()`, after the ASR/translate init block and before `this.connected = true;`, mirror `ZoomAIClient.connect`'s worker boot (15 s init timeout; `null` factory result → skip, test env):
```ts
    await new Promise<void>((resolve, reject) => {
      const worker = this.vadWorkerFactory();
      if (!worker) { resolve(); return; }               // test/no-worker env
      this.vadWorker = worker;
      const timer = setTimeout(() => reject(new Error('VAD worker init timeout')), 15000);
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'ready') { clearTimeout(timer); resolve(); }
        else if (msg.type === 'speech_start') {
          this.asr.sendVadMark?.('start');
          this.emitEvent('local.native.speech_start', 'client', {});
        }
        else if (msg.type === 'speech_end') { this.asr.sendVadMark?.('end'); }
        else if (msg.type === 'speech_cancel') { this.asr.sendVadMark?.('cancel'); }
        else if (msg.type === 'error') {
          if (this.vadReady) { this.handlers.onError?.(`VAD worker: ${msg.message}`); }
          else { clearTimeout(timer); reject(new Error(msg.message)); }
        }
      };
      worker.onerror = (err) => { clearTimeout(timer); reject(err as any); };
      worker.postMessage({
        type: 'init',
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
        vadConfig: {
          threshold: config.vadThreshold,
          minSilenceDuration: config.vadMinSilenceDuration,
          minSpeechDuration: config.vadMinSpeechDuration,
        },
      });
    });
    this.vadReady = true;
```
(add `private vadReady = false;`, reset to `false` in `disconnect()`; a worker error before ready fails `connect`, after ready it is a broken session → `handlers.onError`).
4. `appendInputAudio`:
```ts
  appendInputAudio(audioData: Int16Array): void {
    if (!this.connected) return;
    this.asr.feedAudio(audioData, 24000);
    this.vadWorker?.postMessage({ type: 'audio', pcm: audioData, sampleRate: 24000 });
  }
```
5. `createResponse`: `this.vadWorker?.postMessage({ type: 'flush' }); this.asr.flush?.();`
6. `disconnect`: before disposing the asr client: `this.vadWorker?.postMessage({ type: 'dispose' }); this.vadWorker?.terminate(); this.vadWorker = null; this.vadReady = false;`

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts src/lib/local-inference/native`
Expected: PASS.

- [ ] **Step 7: Commit**

`git add -A src && git commit -m "feat(renderer): native-vad worker drives sidecar segmentation via vad_mark"`

---

### Task 5: Native layer — remove `sk_vad_*`; version 0.3.0

**Files:**
- Delete: `native/src/sk_vad.cpp`, `native/tests/test_vad.cpp`
- Modify: `native/CMakeLists.txt`, `native/tests/CMakeLists.txt`, `native/cmake/upstreams.cmake`, `native/include/sokuji_native.h`, `native/python/sokuji_native/__init__.py`, `native/python/sokuji_native/_ffi.py`, `native/python/tests/test_sokuji_native.py`, `native/README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent, but sequenced last so the sidecar stopped importing the VAD first — Task 2 deleted `vad.py`, the only consumer).
- Produces: `libsokuji_native` 0.3.0 without any `sk_vad` symbol; a rebuilt CPU stage + wheel installed into the dev venv.

- [ ] **Step 1: Delete the surface**

1. `git rm native/src/sk_vad.cpp native/tests/test_vad.cpp`
2. `native/CMakeLists.txt`:
   - line ~80: `target_sources(sokuji_native PRIVATE src/sk_selftest.cpp src/sk_asr.cpp src/sk_vad.cpp)` → drop `src/sk_vad.cpp`;
   - delete the whole silero-weights `install(FILES ... silero_vad_16k.safetensors ...)` block (lines ~143–146) including its comment;
   - `project(sokuji_native VERSION 0.2.0 ...)` → `0.3.0`.
3. `native/tests/CMakeLists.txt`: delete the `test_vad` block (comment, add_executable, link/include/defines, add_test, set_tests_properties — lines ~18–27).
4. `native/cmake/upstreams.cmake`: remove `silero_vad` from the `AUDIOCPP_MODELS` list (grep for it; keep the other six families and the separator format intact).
5. `native/include/sokuji_native.h`: delete the entire VAD section — the doc comment block ("---- VAD (audio.cpp silero_vad) ----" through the end of its prose), `typedef struct sk_vad sk_vad;`, `sk_vad_options`, `sk_vad_event` (+ its event-kind enum if VAD-only), and the five prototypes (`sk_vad_open/feed/finalize/reset/close`). Also update the header's leading comment if it enumerates `sk_vad_` among the stage prefixes.
6. `native/python/sokuji_native/_ffi.py`: delete `sk_vad_options`, `sk_vad_event` Structures and the `lib.sk_vad_*` argtype/restype registrations.
7. `native/python/sokuji_native/__init__.py`: delete `VadEvent`, `Vad`, `vad_open`, their `__all__` entries, and update the module docstring ("Slices 2–4 add asr / vad / translate / tts" → "Slices 2–4 add asr / translate / tts").
8. `native/python/tests/test_sokuji_native.py`: delete `test_vad_events_on_speech` and `test_vad_default_weights_live_next_to_the_library`. The families test (`required = {..., "silero_vad", ...}`): first check whether removing `silero_vad` from `AUDIOCPP_MODELS` removes it from `sk_audio_families()` — run the test after the rebuild in Step 2; if the family is gone, remove it from the `required` set (and from any comment); if audio.cpp compiles it unconditionally, leave the set as-is and add a one-line comment that the family rides along unused.
9. `native/README.md`: in the layout list delete the `src/sk_vad.cpp` row and the weights sentence; retitle "## ASR and VAD (slice 2)" to "## ASR (slice 2)"; delete the whole **VAD** paragraph; in the CTest paragraph drop `test_vad` (`-R 'test_asr'`), and the "ships its own weights for `test_vad`" clause; in the intro line change "audio.cpp (TTS + VAD, six families)" to "audio.cpp (TTS, six families)" and note VAD lives in the renderer per spec Amendment A1.
10. Sweep: `grep -rn -i "sk_vad\|silero" native/src native/include native/python/sokuji_native native/tests native/CMakeLists.txt native/cmake native/README.md` — the only acceptable hits are the families-list entry IF step 8 kept it, and historical mentions in `native/patches/*.json` anchors (leave patch specs alone unless the build breaks).

- [ ] **Step 2: Rebuild and test**

```bash
cmake -S native -B native/build/cpu -DSOKUJI_GPU=none
cmake --build native/build/cpu -j
cmake --install native/build/cpu --prefix native/build/cpu/stage --component sokuji
SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/stage python -m pytest native/python/tests -q
SK_TEST_ASR_GGUF=~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf SK_TEST_ASR_STREAM_GGUF=~/.cache/sokuji-native-tests/moonshine-streaming-tiny-Q8_0.gguf ctest --test-dir native/build/cpu --output-on-failure
```
Expected: package tests pass (VAD tests gone; resolve the families question per Step 1.8); ctest passes with `test_vad` absent from the list. Verify the stage has no safetensors: `ls native/build/cpu/stage` must show no `silero_vad_16k.safetensors`, and `nm -D --defined-only native/build/cpu/stage/libsokuji_native.so | grep sk_vad` must print nothing.

- [ ] **Step 3: Rebuild the wheel and reinstall into the dev venv**

```bash
bash native/ci/build.sh none manylinux_2_39_aarch64
/home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/pip install --force-reinstall native/python/dist/sokuji_native-0.3.0-py3-none-manylinux_2_39_aarch64.whl
```
(adjust the wheel filename to what `build.sh` actually produced). Then re-run the sidecar suite:
`PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests -q`
Expected: PASS minus the 4 baseline failures.

- [ ] **Step 4: Commit**

`git add -A native && git commit -m "feat(native)!: remove sk_vad from the ABI; sokuji-native 0.3.0 (Amendment A1)"`

---

### Task 6: Sweep, gates, and docs

**Files:**
- Modify: whatever the sweeps below surface (expected: none to few)

**Steps:**

- [ ] **Step 1: Repo-wide leftover sweep**

`grep -rn -i "sk_vad\|NativeVad\|vad_open\|silero_vad_16k" src sidecar native docs/superpowers/plans/2026-08-31-client-vad-unification.md --include="*.py" --include="*.ts" --include="*.tsx" --include="*.cpp" --include="*.h" --include="*.md" --include="*.json" --include="*.txt"` — every hit outside this plan file, the spec's Amendment A1 narrative, and the slice-2 plan document (historical) must be fixed. Also `grep -rn "speech_start" sidecar/sokuji_sidecar src/lib/local-inference/native` must be empty.

- [ ] **Step 2: Full gates**

1. Sidecar: `PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests -q` → pass minus the 4 baseline failures.
2. Native: the Task 5 Step 2 commands stay green.
3. Renderer (targeted): `npx vitest run src/lib/local-inference/native src/services/clients/LocalNativeClient.test.ts src/services/clients/ZoomAIClient.test.ts` (drop non-existent paths) → pass; also `npx vitest run src/services/providers` if provider tests exist for local_native config shape.
4. Type check: `npx tsc --noEmit` (or the repo's typecheck script from package.json) → clean for the touched files (pre-existing worktree noise is not yours; compare against `git stash` only mentally — do NOT use bare `git stash`).
5. Real-model offline loopback (GB10, CPU lane): `SOKUJI_RUN_ASR_MODEL=1 PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests/test_asr_engine.py -q -k real_engine` → the sense-voice transcript still contains "gold"/"tribal".

- [ ] **Step 3: Commit any sweep fixes**

`git add -A && git commit -m "chore: client-VAD unification sweep + gates"` (skip if nothing changed).
