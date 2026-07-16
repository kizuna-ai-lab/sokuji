# Session on_close Teardown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidecar's WebSocket server free a closing connection's models without knowing any stage's ctx keys — each stage registers its own cleanup at init via a new `Conn.on_close` seam.

**Architecture:** `server._conn`'s `finally` block currently hard-codes three per-stage teardown branches gated on five engine-specific ctx keys (`on_binary`, `stream_task`, `owns_translate`, `owns_tts`, `tts_stream_task`), so every stage's ownership convention leaks into the transport. This adds `Conn.on_close(cb)` — a list of zero-arg cleanups — and moves each stage's teardown into a named helper in that stage's own module, registered at init. The server's `finally` collapses to a loop that runs the registered cleanups. Two of the five keys (`owns_translate`, `owns_tts`) exist only to signal teardown and are deleted; `on_binary` (the binary feeder at `server.py:37`) and the two task handles (which the cleanups read) stay.

**Tech Stack:** Python 3.12, asyncio, `websockets`, pytest.

## Global Constraints

- **Behaviour-preserving refactor.** No scenario may change what gets closed/cancelled on disconnect. Every teardown helper is a verbatim port of the branch it replaces, including the `try/except Exception: pass` around `eng.close()`.
- **Cleanups run late-bound.** A cleanup must read `conn.ctx` / `state` when it RUNS, never capture values at registration time: `tts_stream_task` is created by `_h_tts_generate` (`tts_engine.py:196`), *after* `_h_tts_init` registered the cleanup.
- **Registration point = ownership point.** Register each stage's cleanup exactly where that stage currently takes ownership, so "cleanup registered" is true in precisely the cases the old marker gate was true. For ASR this means BOTH branches of `_h_asr_init` (streaming and offline), each immediately after `conn.ctx["on_binary"] = ...`.
- **Keys that stay:** `on_binary` (still the binary feeder, read at `server.py:37`), `stream_task`, `tts_stream_task` (read by the cleanups; `tts_stream_task` also has non-teardown readers at `tts_engine.py:180,193-194`). **Keys deleted:** `owns_translate`, `owns_tts` — pure teardown markers with no other reader.
- **Scope: sidecar only.** No TypeScript changes, no wire-protocol changes, no `nativeModelStore` changes.
- **Test command** (run from `sidecar/` inside this worktree; the venv lives in the main repo because `.venv` is gitignored and does not follow a worktree checkout):
  ```bash
  VP=/home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python
  $VP -m pytest tests/ -q
  ```
  Verified: `sokuji_sidecar` resolves to the worktree copy (cwd wins over site-packages).
- **Baseline (unchanged branch):** `766 passed, 15 skipped` in ~7s. Every task must end at ≥ this count with 0 failures.
- English-only code and comments.

---

## File Structure

| File | Responsibility after this plan |
|------|-------------------------------|
| `sidecar/sokuji_sidecar/server.py` | Owns the `Conn.on_close` seam and runs the registered cleanups on disconnect. Knows **zero** engine ctx keys in its `finally`. |
| `sidecar/sokuji_sidecar/asr_engine.py` | Owns `_asr_teardown` + registers it in both branches of `_h_asr_init`. |
| `sidecar/sokuji_sidecar/translate_engine.py` | Owns `_translate_teardown` + registers it in `_h_translate_init`. |
| `sidecar/sokuji_sidecar/tts_engine.py` | Owns `_tts_teardown` + registers it in `_h_tts_init`. |
| `sidecar/tests/test_server_conn.py` | Seam tests (registration → ordered run → error isolation). Loses the marker-injection test. |
| `sidecar/tests/test_asr_engine.py` | Keeps `test_conn_close_frees_asr_model` (behaviour net, passes before AND after). |
| `sidecar/tests/test_tts_engine.py` | Gains `test_conn_close_frees_tts_model` (behaviour net) + `_FakeConn` grows `on_close`. |

**Behaviour nets that must pass unchanged across the whole plan** (they drive real handlers through `_conn` and never touch a marker — they are the proof this refactor preserves behaviour):
- `tests/test_asr_engine.py::test_conn_close_frees_asr_model`
- `tests/test_server_conn.py::test_translate_connection_close_frees_engine`
- `tests/test_server_conn.py::test_non_translate_connection_does_not_free_engine`

---

### Task 1: The `Conn.on_close` seam (dormant runner)

Adds the seam and the runner loop. Nothing registers yet, so the loop is a no-op and the three hard-coded branches still do all the work — zero behaviour change.

**Files:**
- Modify: `sidecar/sokuji_sidecar/server.py:5-14` (class `Conn`), `sidecar/sokuji_sidecar/server.py:60` (start of `_conn`'s `finally`)
- Test: `sidecar/tests/test_server_conn.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Conn.on_close(cb: Callable[[], None]) -> None` — registers a zero-arg cleanup; `Conn._on_close: list` — the registered cleanups, run in registration order by `_conn`'s `finally`. Tasks 2-4 call `conn.on_close(...)`.

- [ ] **Step 1: Write the failing tests**

Add this module-level helper to `sidecar/tests/test_server_conn.py`, directly below the existing `FakeWS` class (which ends at line 12):

```python
class _IterWS:
    """Drives _conn over a fixed message list, then closes (runs _conn's finally)."""

    def __init__(self, messages=()):
        self._msgs = iter(messages)
        self.sent = []

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._msgs)
        except StopIteration:
            raise StopAsyncIteration

    async def send(self, d):
        self.sent.append(d)
```

Append these two tests to the end of `sidecar/tests/test_server_conn.py`:

```python
def test_conn_close_runs_registered_cleanups_in_order():
    """A stage registers its teardown at init; _conn's finally runs it on disconnect,
    in registration order. This is the seam that replaces the hard-coded per-engine
    teardown branches."""
    calls = []

    async def _stage_init(state, msg, _b, conn=None):
        conn.on_close(lambda: calls.append("first"))
        conn.on_close(lambda: calls.append("second"))
        return {"type": "ready", "id": msg.get("id")}, None

    state = {"handlers": {"stage_init": _stage_init}}
    asyncio.run(_conn(state, _IterWS([json.dumps({"type": "stage_init", "id": 1})])))
    assert calls == ["first", "second"]


def test_conn_close_isolates_a_raising_cleanup():
    """One stage's cleanup raising must not skip the cleanups registered after it."""
    calls = []

    async def _stage_init(state, msg, _b, conn=None):
        def _boom():
            calls.append("boom")
            raise RuntimeError("cleanup exploded")

        conn.on_close(_boom)
        conn.on_close(lambda: calls.append("after"))
        return {"type": "ready", "id": msg.get("id")}, None

    state = {"handlers": {"stage_init": _stage_init}}
    asyncio.run(_conn(state, _IterWS([json.dumps({"type": "stage_init", "id": 1})])))
    assert calls == ["boom", "after"]
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
VP=/home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python
$VP -m pytest tests/test_server_conn.py -q -k "cleanup"
```
Expected: 2 failed with `AssertionError: assert [] == ['first', 'second']` (and the analogous empty-list assertion for the isolation test).

Note the failure mode, because it is not the obvious one: `conn.on_close(...)` does raise `AttributeError` inside the fake stage handler, but `_conn` wraps every `handle_message` call in `try/except Exception` (`server.py:49-54`) and converts ANY handler exception into an `{"type": "error"}` reply rather than letting it propagate. So the AttributeError is swallowed, the handler registers nothing, and the only observable RED signal is the assertion on `calls`. That is still a true RED for the right reason (the seam does not exist yet), but do not expect a traceback.

- [ ] **Step 3: Add the seam to `Conn`**

In `sidecar/sokuji_sidecar/server.py`, replace the `Conn` class (lines 5-14) with:

```python
class Conn:
    def __init__(self, ws):
        self._ws = ws
        self.ctx = {}
        self._on_close = []

    def on_close(self, cb):
        """Register a zero-arg cleanup to run when this connection closes.

        Each stage registers its own teardown at init, so the server never has to know
        which ctx keys a stage owns. A cleanup must read conn.ctx/state when it RUNS,
        not when it registers: a stage may create the handle it cancels after init (the
        TTS stream task is created by tts_generate, not tts_init).
        """
        self._on_close.append(cb)

    async def send(self, obj=None, binary=None):
        if binary is not None:
            await self._ws.send(binary)
        if obj is not None:
            await self._ws.send(json.dumps(obj))
```

- [ ] **Step 4: Run the registered cleanups in `_conn`'s finally**

In `sidecar/sokuji_sidecar/server.py`, insert the loop at the TOP of `_conn`'s `finally` block — immediately after the `finally:` line (currently line 60) and BEFORE the existing `# A session connection closing is "stop"` comment. Leave the three existing branches and their comment exactly as they are; nothing registers a cleanup yet, so the loop is a no-op.

```python
    finally:
        # Each stage registers its own cleanup at init (conn.on_close); run them without
        # knowing any stage's ctx keys. Cleanups are independent — one raising must not
        # skip the rest.
        for cb in conn._on_close:
            try:
                cb()
            except Exception:
                pass
        # A session connection closing is "stop": free that connection's model from VRAM.
        # Ownership is per-connection: ASR streaming sets on_binary, the translate session
        # sets owns_translate; the model-management connection sets neither and leaves
        # models alone. Both engines are process singletons reused on the next init.
        if conn.ctx.get("on_binary") is not None:
            # ... the three existing teardown branches (lines 65-91) stay exactly as they
            # are in this task — do not edit or delete them here. Tasks 2-4 remove them
            # one at a time as each stage starts registering its own cleanup.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
$VP -m pytest tests/test_server_conn.py -q
```
Expected: 10 passed (8 existing + 2 new).

- [ ] **Step 6: Verify zero behaviour change**

```bash
$VP -m pytest tests/ -q
```
Expected: **768 passed, 15 skipped**, 0 failed — the 766 baseline tests all still pass (nothing registers a cleanup yet, so the new loop is a no-op and the old branches still do the work), plus the 2 new seam tests.

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/server.py sidecar/tests/test_server_conn.py
git commit -m "feat(sidecar): add Conn.on_close seam for per-stage session teardown"
```

---

### Task 2: Migrate ASR teardown to `on_close`

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (new `_asr_teardown` above `_h_asr_init:532`; registration at both `on_binary` sites, currently `:554` and `:562`)
- Modify: `sidecar/sokuji_sidecar/server.py` (delete the `on_binary` teardown branch; trim its mention from the legacy comment)
- Test: `sidecar/tests/test_asr_engine.py` (comment-only update to `test_conn_close_frees_asr_model:314`)

**Interfaces:**
- Consumes: `Conn.on_close(cb)` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Confirm the behaviour net is green before touching anything**

`test_conn_close_frees_asr_model` drives `_conn` with a real `asr_init` message and asserts `engine.close()` ran. It never reads a marker, so it must pass both before and after this task — that is what makes it the proof of preservation.

```bash
VP=/home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python
$VP -m pytest tests/test_asr_engine.py -q -k "conn_close_frees_asr_model"
```
Expected: 1 passed.

- [ ] **Step 2: Add the teardown helper**

In `sidecar/sokuji_sidecar/asr_engine.py`, insert directly above `async def _h_asr_init(...)` (currently line 532):

```python
def _asr_teardown(state, conn):
    """Free this connection's ASR model when the connection closes (stop = release VRAM).

    Reads the stream task from conn.ctx at close time — the offline path never creates one.
    """
    task = conn.ctx.get("stream_task")
    if task is not None:
        task.cancel()
    eng = state.get("asr_engine")
    if eng is not None:
        try:
            eng.close()
        except Exception:
            pass
```

- [ ] **Step 3: Register the cleanup in both branches**

In `sidecar/sokuji_sidecar/asr_engine.py`, in `_h_asr_init`, add the registration immediately after each `conn.ctx["on_binary"] = ...` assignment. The two branches are mutually exclusive, so exactly one registration runs per init — this makes "cleanup registered" true in precisely the cases the old `on_binary is not None` gate was true.

```python
    if is_streaming:
        # Streaming path: init_streaming resolves+loads the backend once.
        eng.init_streaming(model, language, sample_rate,
                           vad_threshold, vad_min_silence, vad_min_speech, device, pin=pin)
        if conn is not None:
            conn.ctx["on_binary"] = eng.feed_stream
            conn.ctx["stream_task"] = asyncio.create_task(eng.run_stream(conn.send))
            conn.on_close(lambda: _asr_teardown(state, conn))
        ms = 0
    else:
        # Offline path (unchanged Phase 1 behaviour): init() loads the model once.
        ms = eng.init(model, language, sample_rate,
                      vad_threshold, vad_min_silence, vad_min_speech, device, pin=pin)
        if conn is not None:
            conn.ctx["on_binary"] = eng.feed
            conn.on_close(lambda: _asr_teardown(state, conn))
```

- [ ] **Step 4: Delete the ASR branch from the server**

In `sidecar/sokuji_sidecar/server.py`, delete this entire block from `_conn`'s `finally` (it currently sits directly under the legacy comment):

```python
        if conn.ctx.get("on_binary") is not None:
            task = conn.ctx.get("stream_task")
            if task is not None:
                task.cancel()
            eng = state.get("asr_engine")
            if eng is not None:
                try:
                    eng.close()
                except Exception:
                    pass
```

And drop ASR from the legacy comment, which now covers only the two remaining branches:

```python
        # A session connection closing is "stop": free that connection's model from VRAM.
        # Ownership is per-connection: the translate session sets owns_translate, the TTS
        # session sets owns_tts; the model-management connection sets neither and leaves
        # models alone. Both engines are process singletons reused on the next init.
```

- [ ] **Step 5: Update the stale comment on the behaviour net**

In `sidecar/tests/test_asr_engine.py`, the test body does not change — only its comment, which named the now-removed gate. Replace lines 315-316:

```python
    # A session connection (asr_init registers its cleanup) closing must trigger
    # engine.close() in _conn's finally, releasing the model from VRAM on stop.
```

- [ ] **Step 6: Run the tests**

```bash
$VP -m pytest tests/test_asr_engine.py tests/test_server_conn.py -q
```
Expected: all passed, including `test_conn_close_frees_asr_model` (unchanged behaviour through the new path).

- [ ] **Step 7: Run the full suite**

```bash
$VP -m pytest tests/ -q
```
Expected: `768 passed, 15 skipped`.

- [ ] **Step 8: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/sokuji_sidecar/server.py sidecar/tests/test_asr_engine.py
git commit -m "refactor(sidecar): register ASR session teardown via conn.on_close"
```

---

### Task 3: Migrate translate teardown to `on_close`

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_engine.py` (new `_translate_teardown`; replace the `owns_translate` marker at `:69-71` with a registration)
- Modify: `sidecar/sokuji_sidecar/server.py` (delete the `owns_translate` branch; trim its mention from the legacy comment)
- Test: none changed — `tests/test_server_conn.py::test_translate_connection_close_frees_engine` and `::test_non_translate_connection_does_not_free_engine` already drive the real handler through `_conn` and must pass unchanged.

**Interfaces:**
- Consumes: `Conn.on_close(cb)` from Task 1.
- Produces: nothing later tasks depend on.

Note the helper signature: `_translate_teardown(state)` takes no `conn` because the translate teardown has no task handle to cancel — it only closes the engine. Do not add an unused `conn` parameter for symmetry with the ASR/TTS helpers; a dead parameter is a review defect.

- [ ] **Step 1: Confirm the behaviour nets are green first**

```bash
VP=/home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python
$VP -m pytest tests/test_server_conn.py -q -k "translate"
```
Expected: 2 passed (`test_translate_connection_close_frees_engine`, `test_non_translate_connection_does_not_free_engine`).

- [ ] **Step 2: Add the teardown helper**

In `sidecar/sokuji_sidecar/translate_engine.py`, insert directly above `async def _h_translate_init(...)`:

```python
def _translate_teardown(state):
    """Free this connection's translate model when the connection closes."""
    eng = state.get("translate_engine")
    if eng is not None:
        try:
            eng.close()
        except Exception:
            pass
```

- [ ] **Step 3: Replace the marker with a registration**

In `sidecar/sokuji_sidecar/translate_engine.py`, replace lines 69-71:

```python
    # This connection owns the translate model: closing it frees the model from VRAM
    # (mirrors the ASR streaming connection's on_binary ownership in server._conn).
    if conn is not None:
        conn.ctx["owns_translate"] = True
```

with:

```python
    # This connection owns the translate model: closing it frees the model from VRAM.
    if conn is not None:
        conn.on_close(lambda: _translate_teardown(state))
```

- [ ] **Step 4: Delete the translate branch from the server**

In `sidecar/sokuji_sidecar/server.py`, delete this block from `_conn`'s `finally`:

```python
        if conn.ctx.get("owns_translate"):
            teng = state.get("translate_engine")
            if teng is not None:
                try:
                    teng.close()
                except Exception:
                    pass
```

And drop translate from the legacy comment, which now covers only the TTS branch:

```python
        # A session connection closing is "stop": free that connection's model from VRAM.
        # Ownership is per-connection: the TTS session sets owns_tts; the model-management
        # connection does not and leaves models alone. The engine is a process singleton
        # reused on the next init.
```

- [ ] **Step 5: Run the tests**

```bash
$VP -m pytest tests/test_server_conn.py tests/test_translate_engine.py -q
```
Expected: all passed, including the two translate behaviour nets — unchanged, through the new path.

- [ ] **Step 6: Verify `owns_translate` is gone**

```bash
grep -rn "owns_translate" sokuji_sidecar/ tests/
```
Expected: no output.

- [ ] **Step 7: Run the full suite**

```bash
$VP -m pytest tests/ -q
```
Expected: `768 passed, 15 skipped`.

- [ ] **Step 8: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_engine.py sidecar/sokuji_sidecar/server.py
git commit -m "refactor(sidecar): register translate session teardown via conn.on_close"
```

---

### Task 4: Migrate TTS teardown to `on_close` (last branch)

This task removes the final hard-coded branch, so `_conn`'s `finally` ends up as just the cleanup loop. TTS is the only stage without a handler-driven behaviour net — Step 1 adds one and proves it green on the OLD code before Step 3 changes anything.

**Files:**
- Modify: `sidecar/tests/test_tts_engine.py` (add `import json` + `server` import; new `test_conn_close_frees_tts_model`; `_FakeConn:107-109` grows `on_close`; `test_handler_tts_init_ready_sets_ownership:119-126` asserts registration instead of the marker)
- Modify: `sidecar/sokuji_sidecar/tts_engine.py` (new `_tts_teardown`; replace the `owns_tts` marker at `:142-143` with a registration)
- Modify: `sidecar/sokuji_sidecar/server.py` (delete the `owns_tts` branch + the legacy comment; promote the loop's comment to its final form)
- Modify: `sidecar/tests/test_server_conn.py` (delete `test_owns_tts_closes_engine_on_disconnect:217-240`)

**Interfaces:**
- Consumes: `Conn.on_close(cb)` from Task 1.
- Produces: `_conn`'s `finally` in its final form — the cleanup loop only.

- [ ] **Step 1: Add the TTS behaviour net and prove it green on the OLD code**

In `sidecar/tests/test_tts_engine.py`, change the import block at the top (currently lines 1-4) to add `json` and `server`:

```python
import asyncio
import json
import numpy as np
import pytest
from sokuji_sidecar import tts_engine, accel, catalog, server
```

Append this test to the end of `sidecar/tests/test_tts_engine.py`.

It uses a hand-rolled fake engine rather than the real `TtsEngine`, for the same reason the existing ASR analogue (`test_conn_close_frees_asr_model`) does — and this is the whole trap here: **`TtsEngine.init()` calls `self.close()` itself** for VRAM hygiene (`tts_engine.py:46`), exactly as `AsrEngine.close()`'s docstring advertises ("called at the start of each init()"). Drive a *real* engine through one `tts_init` and `close()` fires twice — once inside `init()`, once from the disconnect teardown — so a `== 1` assertion fails and a `== 2` assertion could not tell you whether the disconnect closed anything at all. A fake engine whose `init()` does not self-close isolates the disconnect path, which is the only thing this test is here to pin.

`_h_tts_init` touches exactly three things on the engine — `init(...)`, `sample_rate`, `resolved` — so the fake needs only those, and no `_patch`/`_state`/`monkeypatch` machinery at all.

```python
def test_conn_close_frees_tts_model():
    """A TTS session connection (tts_init) closing must trigger engine.close() in
    _conn's finally, releasing the model from VRAM on stop — the TTS analogue of
    test_conn_close_frees_asr_model.

    Uses a fake engine for the same reason that test does: the real TtsEngine.init()
    calls close() itself for VRAM hygiene (tts_engine.py:46), so a real engine would
    count two closes for one tts_init and could not show whether the DISCONNECT closed
    the model."""
    closed = {"n": 0}

    class Eng:
        sample_rate = 24000
        resolved = None

        def init(self, *a, **k):
            return 1

        def close(self):
            closed["n"] += 1

    st = {"tts_engine": Eng(), "handlers": {}}
    tts_engine.register(st)

    class WS:
        def __init__(self):
            self._msgs = [json.dumps({"type": "tts_init", "id": 1, "model": "moss-tts-nano"})]

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._msgs:
                return self._msgs.pop(0)
            raise StopAsyncIteration

        async def send(self, d):
            pass

    asyncio.run(server._conn(st, WS()))
    assert closed["n"] == 1
```

This exact test has been verified green on the unmigrated code and mutation-verified non-vacuous (disabling the `owns_tts` branch in `server.py` turns it red with `assert 0 == 1`).

- [ ] **Step 2: Run it — it must PASS on the unmigrated code**

```bash
VP=/home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python
$VP -m pytest tests/test_tts_engine.py -q -k "conn_close_frees_tts_model"
```
Expected: 1 passed — it currently exercises the `owns_tts` branch. This is a characterization test, not a red TDD test: it must be green BEFORE the migration (proving it captures today's behaviour) and stay green AFTER (proving the migration preserved it). If it fails here, stop — the test does not characterize the current path and the rest of the task is unsafe.

Commit the net on its own so the "green before" state is in history:

```bash
git add sidecar/tests/test_tts_engine.py
git commit -m "test(sidecar): pin TTS session-close frees-model behaviour before refactor"
```

- [ ] **Step 3: Add the teardown helper**

In `sidecar/sokuji_sidecar/tts_engine.py`, insert directly above `async def _h_tts_init(...)`:

```python
def _tts_teardown(state, conn):
    """Free this connection's TTS model when the connection closes.

    Reads the stream task from conn.ctx at close time: tts_generate creates it after
    tts_init registered this cleanup.
    """
    task = conn.ctx.get("tts_stream_task")
    if task is not None:
        task.cancel()
    eng = state.get("tts_engine")
    if eng is not None:
        try:
            eng.close()
        except Exception:
            pass
```

- [ ] **Step 4: Replace the marker with a registration**

In `sidecar/sokuji_sidecar/tts_engine.py`, in `_h_tts_init`, replace:

```python
    if conn is not None:
        conn.ctx["owns_tts"] = True
```

with:

```python
    # This connection owns the TTS model: closing it frees the model from VRAM.
    if conn is not None:
        conn.on_close(lambda: _tts_teardown(state, conn))
```

- [ ] **Step 5: Delete the last branch and finalise the server's finally**

In `sidecar/sokuji_sidecar/server.py`, delete the `owns_tts` block AND the legacy comment above it, then promote the loop's comment. `_conn`'s `finally` becomes exactly:

```python
    finally:
        # A session connection closing is "stop": free that connection's model from VRAM.
        # Each stage registers its own cleanup at init (conn.on_close), so the server
        # never needs to know which ctx keys a stage owns; the model-management
        # connection registers none and leaves models alone. The engines are process
        # singletons reused on the next init. Cleanups are independent — one raising
        # must not skip the rest.
        for cb in conn._on_close:
            try:
                cb()
            except Exception:
                pass
```

- [ ] **Step 6: Give `_FakeConn` the seam**

`_FakeConn` is the only hand-rolled connection double in the suite (every other test passes a real `server.Conn`). It is handed to `tts_init`, which now calls `conn.on_close(...)`, so it must carry the same API. In `sidecar/tests/test_tts_engine.py`, replace lines 107-109:

```python
class _FakeConn:
    def __init__(self): self.ctx = {}; self.sent = []; self._on_close = []
    def on_close(self, cb): self._on_close.append(cb)
    async def send(self, obj=None, binary=None): self.sent.append((obj, binary))
```

- [ ] **Step 7: Assert registration instead of the marker**

In `sidecar/tests/test_tts_engine.py`, replace the last line of `test_handler_tts_init_ready_sets_ownership` (`assert conn.ctx.get("owns_tts") is True`) with:

```python
    assert len(conn._on_close) == 1        # tts_init registered this session's cleanup
```

- [ ] **Step 8: Delete the superseded marker-injection test**

In `sidecar/tests/test_server_conn.py`, delete `test_owns_tts_closes_engine_on_disconnect` (lines 217-240) in full. It monkeypatched `server.Conn` to inject a marker that no longer exists; `test_conn_close_frees_tts_model` (Step 1) supersedes it by driving the real `tts_init` handler through `_conn`, which is strictly stronger coverage of the same behaviour.

- [ ] **Step 9: Run the tests**

```bash
$VP -m pytest tests/test_tts_engine.py tests/test_server_conn.py -q
```
Expected: all passed. `test_conn_close_frees_tts_model` is still green — now through the `on_close` path.

- [ ] **Step 10: Run the full suite**

```bash
$VP -m pytest tests/ -q
```
Expected: `768 passed, 15 skipped` (baseline 766 + 2 seam tests + 1 TTS net − 1 deleted marker test).

- [ ] **Step 11: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_engine.py sidecar/sokuji_sidecar/server.py sidecar/tests/test_tts_engine.py sidecar/tests/test_server_conn.py
git commit -m "refactor(sidecar): register TTS session teardown via conn.on_close"
```

---

### Task 5: Final verification sweep

Proves the goal was actually met rather than assumed.

**Files:** none modified (verification only; if a check fails, fix it here and re-run).

- [ ] **Step 1: The server's finally knows zero engine ctx keys**

```bash
VP=/home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python
grep -n "owns_translate\|owns_tts\|stream_task\|asr_engine\|translate_engine\|tts_engine" sokuji_sidecar/server.py
```
Expected: no output. (`on_binary` still appears at `server.py:37` — that is the binary feeder, not teardown. Confirm the only hit for it is the feeder:)

```bash
grep -n "on_binary" sokuji_sidecar/server.py
```
Expected: exactly one hit, the feeder at line ~37.

- [ ] **Step 2: The deleted markers are gone repo-wide**

```bash
grep -rn "owns_translate\|owns_tts" sokuji_sidecar/ tests/
```
Expected: no output.

- [ ] **Step 3: Each stage owns its teardown**

```bash
grep -rn "on_close" sokuji_sidecar/
```
Expected: the `Conn.on_close` definition + the loop in `server.py`, one registration in `translate_engine.py`, one in `tts_engine.py`, and two in `asr_engine.py` (streaming + offline).

- [ ] **Step 4: Full suite green**

```bash
$VP -m pytest tests/ -q
```
Expected: `768 passed, 15 skipped`, 0 failed.

- [ ] **Step 5: The three behaviour nets specifically**

```bash
$VP -m pytest -q \
  tests/test_asr_engine.py::test_conn_close_frees_asr_model \
  tests/test_tts_engine.py::test_conn_close_frees_tts_model \
  tests/test_server_conn.py::test_translate_connection_close_frees_engine \
  tests/test_server_conn.py::test_non_translate_connection_does_not_free_engine
```
Expected: 4 passed — every stage still frees its model on disconnect, and a non-owning connection still does not.

- [ ] **Step 6: Commit any fixes**

If Steps 1-5 all pass with no changes, there is nothing to commit — say so rather than creating an empty commit.
