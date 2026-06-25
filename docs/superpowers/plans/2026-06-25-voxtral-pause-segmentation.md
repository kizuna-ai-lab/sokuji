# Voxtral Pause-Driven Segmentation (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut ASR finals on silero's speech→silence endpoint (governed by the user's Min Silence Duration slider) via `end()`+reopen — flushing the complete held tail so the last word lands at the pause, and making the slider the live pause control.

**Architecture:** Rework the just-landed `_drive_always`: drop the hardcoded `_silence_samples`/2.5 s counter and the `split_sentences` punctuation cut; cut on the silero endpoint (new `falling` edge from `_vad_state`) by calling `end()` (the only flush that commits the last token) and reopening a fresh stream. The asyncio audio queue is the during-`end()` buffer (serial, no leading loss). Keep a 20 s run-on cap + a min-utterance guard. The `_drive_utterance` fallback, backpressure degrade, transport, wire, and renderer are unchanged.

**Tech Stack:** Python sidecar (transformers 5.13 fork, threading + asyncio, sherpa-onnx silero VAD), pytest; no renderer changes.

## Spike findings (verified live — build on these)

- **Soft-flush is insufficient:** feeding `_right_pad` silence mid-stream WITHOUT ending flushed most of a held tail but **kept holding the last word** until real new audio arrived. A non-terminating generate always holds the final token. **Only `end()` (terminates the generate) yields a complete final.**
- **`end()` returns the complete transcript** including the held tail (proven; `VoxtralRealtimeStream.end()`).
- **VAD chain is fully plumbed** to silero (`vadMinSilenceDuration` default 1.4 s) but `_drive_always` ignores silero's endpoint and uses a hardcoded 2.5 s counter — so the slider is masked. This plan makes the endpoint the trigger.

## Global Constraints

- **Cut on silero's endpoint**, not a constant: `_vad_state` reports a `falling` edge (`is_speech_detected()` True→False), governed by the user's `vadMinSilenceDuration`. Remove `_silence_samples`, the `2.5 * TARGET_RATE` cut, the 4-min safety, and the `split_sentences` punctuation cut from `_drive_always`.
- **Pause-cut = `end()` + reopen.** `final = await loop.run_in_executor(None, self._stream.end)`; emit `final` as the `result` (the complete tail); `self._stream = self._backend.open_stream()`; reset per-stream state. The result text is **`end()`'s return**, not `_pending` (which lacks the tail).
- **Min-utterance guard:** only cut when `self._pending.strip()` is non-empty.
- **Run-on cap:** `self._speech_samples >= 20 * TARGET_RATE` (20 s of speech with no endpoint) forces an `end()`+reopen. A bound, not a knob.
- **Per-stream backpressure counters:** `_end_and_reopen` and the aborted self-heal reset `_fed_s = 0.0` and `_delta_count = 0` (each utterance is a fresh stream; `end()`-flushed tokens aren't counted, so the lag must measure the current stream only).
- **Unchanged:** `_drive_utterance` (per-utterance fallback) + `_vad_events`; the backpressure degrade (lag > 3 s → per-utterance); `run_stream`/`feed_stream`/`_drive_once` mode dispatch; the offline path; the `partial`/`result` wire shape; the renderer; the VAD plumbing. Default `vadMinSilenceDuration` stays 1.4 s.
- **Tests:** `cd sidecar && .venv/bin/python -m pytest`. GPU tests gated on `SOKUJI_RUN_GPU`. English-only comments.

---

### Task 1: `_vad_state` reports the falling edge

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (`_vad_state`, ~line 283)
- Test: `sidecar/tests/test_asr_engine.py`

**Interfaces:**
- Produces: `_vad_state(samples) -> (had_speech: bool, rising: bool, falling: bool)` — `falling` is True if `is_speech_detected()` went True→False on any window in this buffer (silero's endpoint). Task 2 cuts on `falling`.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_asr_engine.py`:

```python
def test_vad_state_reports_rising_and_falling_edges():
    import numpy as np
    from sokuji_sidecar.asr_engine import AsrEngine

    class _FakeVad:
        """is_speech_detected() returns the current state; accept_waveform() advances it
        through `after` (the state AFTER each window)."""
        def __init__(self, start, after):
            self._cur = start
            self._after = list(after)
            self._k = 0
        def is_speech_detected(self):
            return self._cur
        def accept_waveform(self, w):
            self._cur = self._after[self._k]
            self._k += 1

    # falling: start speaking, one window flips to silence
    eng = AsrEngine()
    eng._vad = _FakeVad(start=True, after=[False])
    eng._window = 100
    eng._buf = np.zeros(0, np.float32)
    had, rising, falling = eng._vad_state(np.zeros(100, np.float32))
    assert (had, rising, falling) == (False, False, True)

    # rising: start silent, one window flips to speech
    eng2 = AsrEngine()
    eng2._vad = _FakeVad(start=False, after=[True])
    eng2._window = 100
    eng2._buf = np.zeros(0, np.float32)
    had2, rising2, falling2 = eng2._vad_state(np.zeros(100, np.float32))
    assert (had2, rising2, falling2) == (True, True, False)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k vad_state_reports -v`
Expected: FAIL — `_vad_state` returns a 2-tuple, `ValueError: not enough values to unpack`.

- [ ] **Step 3: Add the falling edge**

In `sidecar/sokuji_sidecar/asr_engine.py`, replace `_vad_state` with:

```python
    def _vad_state(self, samples):
        """Run silero VAD over `samples` for STATE only (always-stream): return
        (had_speech, rising, falling). `falling` = silero's endpoint (is_speech_detected
        True->False this buffer), governed by the user's min_silence_duration. Does not
        gate input."""
        had_speech = False
        rising = False
        falling = False
        self._buf = np.concatenate([self._buf, samples])
        while len(self._buf) >= self._window:
            was = self._vad.is_speech_detected()
            self._vad.accept_waveform(self._buf[:self._window])
            self._buf = self._buf[self._window:]
            now = self._vad.is_speech_detected()
            if now:
                had_speech = True
            if not was and now:
                rising = True
            if was and not now:
                falling = True
        return had_speech, rising, falling
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k vad_state_reports -v`
Expected: PASS. (The full suite is red until Task 2 — `_drive_always` still unpacks 2 values. That's expected; Task 2 fixes it.)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/tests/test_asr_engine.py
git commit -m "feat(sidecar): _vad_state reports silero falling edge (endpoint)"
```

---

### Task 2: Rework `_drive_always` to cut on the endpoint via end()+reopen

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (`init_streaming`, `run_stream` exit, remove `_flush_and_restart`, add `_end_and_reopen`, rewrite `_drive_always`)
- Test: `sidecar/tests/test_asr_engine.py` (replace the punctuation/long-silence tests; update the aborted + backpressure tests)

**Interfaces:**
- Consumes: `_vad_state` 3-tuple (Task 1); `VoxtralRealtimeStream` `feed`/`drain`/`end`/`abort` via `open_stream()`; `_result_event`, `_downsample_int16_to_f32_16k`, `TARGET_RATE`, `_audio_q`.
- Produces: `_end_and_reopen(send)`; reworked `_drive_always` (cuts on `falling`/20 s cap); `init_streaming` adds `_speech_samples`, drops `_silence_samples`/`_stream_speech_samples`/`_utt_text`.

- [ ] **Step 1: Replace the punctuation/long-silence tests; add endpoint/cap/guard tests; update aborted + backpressure**

In `sidecar/tests/test_asr_engine.py`: DELETE `test_always_stream_feeds_all_and_cuts_on_punctuation` and `test_always_stream_long_silence_flushes_and_restarts` (their mechanisms are gone). Add:

```python
def test_always_stream_cuts_on_endpoint_with_complete_tail(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return "country can do for you. do for your country."   # COMPLETE (tail incl.)
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = "country can do for you."          # partial: the tail is MISSING here
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0; eng._speech_samples = 0
    monkeypatch.setattr(eng, "_vad_state", lambda s: (False, False, True))   # endpoint this buffer

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    results = [m for m in sent if m["type"] == "result"]
    assert results and "do for your country." in results[-1]["text"]   # the held tail is in the final
    assert opened["n"] == 1                                            # reopened
    assert eng._pending == "" and eng._fed_s == 0.0 and eng._delta_count == 0


def test_always_stream_endpoint_with_no_text_does_not_cut(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return ""
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = ""                                  # nothing transcribed
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0; eng._speech_samples = 0
    monkeypatch.setattr(eng, "_vad_state", lambda s: (False, False, True))   # endpoint, but no text

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    assert not [m for m in sent if m["type"] == "result"]   # min-utterance guard: no cut
    assert opened["n"] == 0


def test_always_stream_runon_cap_forces_cut(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, s): pass
        def drain(self): return []
        def end(self): return "a very long run on utterance"
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = "a very long run on"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0
    eng._speech_samples = 20 * 16000                   # already at the run-on cap
    monkeypatch.setattr(eng, "_vad_state", lambda s: (True, False, False))   # speaking, no endpoint

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    assert opened["n"] == 1                            # cap forced an end()+reopen
    assert [m for m in sent if m["type"] == "result"]
```

Then UPDATE the two existing tests that referenced removed state:
- In `test_always_stream_aborted_self_heals`: change `eng._utt_text = "partial words"` to `eng._pending = "partial words"`, change the VAD stub to `monkeypatch.setattr(eng, "_vad_state", lambda s: (True, False, False))`, and add `eng._speech_samples = 0; eng._fed_s = 0.0; eng._delta_count = 0` to the setup. Keep the assertions (result `"partial words"` + `opened["n"] == 1`).
- In `test_backpressure_degrades_to_per_utterance`: change the VAD stub to `monkeypatch.setattr(eng, "_vad_state", lambda s: (True, False, False))` and add `eng._speech_samples = 0` to the setup. Keep the assertions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k "endpoint or runon or aborted or backpressure" -v`
Expected: FAIL — `_drive_always` still cuts on punctuation / `_vad_state` 2-tuple unpack / `_end_and_reopen` undefined.

- [ ] **Step 3: Rework the engine**

In `sidecar/sokuji_sidecar/asr_engine.py`:

(a) In `init_streaming`, replace the always-stream state block (the lines from `self._pending = ""` through `self._delta_count = 0`) with:

```python
        self._pending = ""           # text drained since the last cut (the partial)
        self._partial_acc = []       # per-utterance fallback accumulator
        self._utt_start_sample = 0
        self._sample_cursor = 0
        self._utt_samples = 0        # per-utterance fallback (its own cap)
        self._speech_samples = 0     # speech in the current stream (20s run-on cap)
        self._fed_s = 0.0            # audio seconds fed to the current stream (backpressure)
        self._delta_count = 0        # tokens drained from the current stream (backpressure)
```

(b) Replace the `run_stream` tail (the `if self._mode == "always_stream": / if self._utt_text: ... elif self._stream is not None: await self._finalize(send)` block) with:

```python
        if self._mode == "always_stream":
            if self._stream is not None and self._pending.strip():
                try:
                    final = await loop.run_in_executor(None, self._stream.end)
                except Exception:
                    final = ""
                self._stream = None
                if final.strip():
                    await send(self._result_event(final))
        elif self._stream is not None:
            await self._finalize(send)
```

(c) DELETE `_flush_and_restart` entirely.

(d) Add `_end_and_reopen` (next to `_result_event`):

```python
    async def _end_and_reopen(self, send):
        """Pause-cut: end() the stream to flush the COMPLETE held tail, emit it as the
        result, then open a fresh stream. Audio arriving during the ~1s end() backs up in
        _audio_q and feeds the new stream after — no leading loss. Per-stream backpressure
        counters reset (end()'s flushed tokens aren't counted via drain())."""
        loop = asyncio.get_running_loop()
        try:
            final = await loop.run_in_executor(None, self._stream.end)
        except Exception:                                # end() failed -> drop this final, still recover
            final = ""
        if final.strip():
            await send(self._result_event(final))
        self._stream = self._backend.open_stream()
        self._pending = ""
        self._speech_samples = 0
        self._fed_s = 0.0
        self._delta_count = 0
```

(e) Replace `_drive_always` with:

```python
    async def _drive_always(self, send, int16_bytes):
        """Always-stream: feed every buffer (no gating); cut a final on silero's endpoint
        (the falling edge, governed by the user's min_silence_duration) — or a 20s run-on
        cap — via end()+reopen, which flushes the COMPLETE held tail. Continuous feed means
        no leading loss."""
        samples = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
        self._sample_cursor += len(samples)
        self._fed_s += len(samples) / TARGET_RATE
        self._stream.feed(samples)                       # continuous, never gated
        try:
            had_speech, rising, falling = self._vad_state(samples)
        except Exception:                                # VAD failure -> assume speech, no edges
            had_speech, rising, falling = True, False, False
        if rising:
            await send({"type": "speech_start"})
        if had_speech:
            self._speech_samples += len(samples)
        deltas = self._stream.drain()
        self._delta_count += len(deltas)
        if deltas:
            self._pending += "".join(deltas)
            await send({"type": "partial", "text": self._pending.strip()})
        if getattr(self._stream, "aborted", False):      # generate died -> salvage + reopen
            if self._pending.strip():
                await send(self._result_event(self._pending))
            try:
                self._stream.abort()
            except Exception:
                pass
            self._stream = self._backend.open_stream()
            self._pending = ""; self._speech_samples = 0
            self._fed_s = 0.0; self._delta_count = 0
            return
        if (falling or self._speech_samples >= 20 * TARGET_RATE) and self._pending.strip():
            await self._end_and_reopen(send)
            return
        lag = self._fed_s - self._delta_count * 0.08          # ~0.56s healthy; >3s = can't keep up
        if self._mode == "always_stream" and lag > 3.0:
            if self._pending.strip():
                await send(self._result_event(self._pending))
            try:
                self._stream.abort()
            except Exception:
                pass
            self._stream = None
            self._mode = "per_utterance"
            self._pending = ""
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k "vad_state_reports or endpoint or runon or aborted or backpressure" -v`
Expected: PASS. Then the FULL `tests/test_asr_engine.py` → PASS (offline + transport + per-utterance fallback unaffected; the GPU e2e test is updated in Task 3).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/tests/test_asr_engine.py
git commit -m "feat(sidecar): cut always-stream finals on the silero endpoint via end()+reopen (complete tail, user-tunable pause)"
```

---

### Task 3: GPU smoke — tail-hold fix

**Files:**
- Test: `sidecar/tests/test_asr_engine.py` (update `test_streaming_end_to_end_real_gpu`)

**Interfaces:**
- Consumes: the full pause-segmentation path + a real GPU + the cached model + `benchmark/test-speech-silence-speech.wav`.
- Produces: a gated test proving the tail-hold fix (the first sentence's last word is in the first final) + no leading loss.

- [ ] **Step 1: Update the assertions in the gated test**

In `test_streaming_end_to_end_real_gpu` (keep the existing setup: model download, the `speech-silence-speech` clip, `init_streaming(sample_rate=sr, device="cuda")`, the paced concurrent feeder with the `None` sentinel, the `open_stream` restart counter). Replace the assertion block (`results = ...` onward) with:

```python
    results = [m["text"] for m in sent if m["type"] == "result"]
    full = " ".join(results).lower()
    assert results, "no finals produced"
    # tail-hold fix: the first sentence ends with "country" and it must be IN a final,
    # not dropped/leaked onto the next utterance.
    assert "ask" in full and "country" in full, f"unexpected: {results!r}"
    # endpoint segmentation: the mid-clip pause should cut at least one final mid-clip,
    # so >1 final (not one clump) and >1 stream opened (each utterance ended at its pause).
    print(f"pause-seg e2e: {len([m for m in sent if m['type']=='partial'])} partials, "
          f"{len(results)} finals, stream opens={opens['n']}, finals={results!r}")
    assert len(results) >= 2, f"expected the pause to segment into >=2 finals, got {results!r}"
    eng.close()
```

- [ ] **Step 2: Verify it skips without the flag**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k streaming_end_to_end -v` → `1 skipped`.

- [ ] **Step 3: Commit** (the controller runs the real GPU pass separately)

```bash
git add sidecar/tests/test_asr_engine.py
git commit -m "test(sidecar): GPU smoke asserts pause segmentation + tail-hold fix"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Full sidecar pytest**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS (GPU-gated tests skip).

- [ ] **Step 2: Renderer vitest (unchanged contract)**

Run: `npm run test -- src/lib/local-inference/native/ src/services/clients/LocalNativeClient.test.ts --run`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit only if Steps 1-3 surfaced fixes**

If a fix was needed: `git add -A && git commit -m "test(native): green pause-segmentation suites"`. Otherwise nothing to commit.
