# Voxtral Realtime Always-Stream (option d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Voxtral Realtime streaming engine to feed audio **continuously** (no VAD input-gating → no leading-word loss) and segment the **output** into per-sentence finals by the model's punctuation, with backpressure-driven degradation to Phase 2's per-utterance mode on hardware that can't keep up.

**Architecture:** The engine gains a `_mode` (`"always_stream"` default | `"per_utterance"` fallback). Always-stream opens one long-lived `VoxtralRealtimeStream` up front, feeds every buffer, runs VAD only for state (speech-start cue, long-silence restart), drains tokens into a `_pending` buffer, and cuts `result`s on sentence-final punctuation (`split_sentences`). A growing input backlog flips `_mode` to per-utterance (the kept-as-is Phase 2 `_drive`). Reuses Phase 2's `VoxtralRealtimeStream`, transport, wire, and renderer unchanged.

**Tech Stack:** Python sidecar (transformers 5.13 fork, torch cu128, threading + asyncio, silero VAD), pytest; no renderer changes.

## Spike findings (verified live on the RTX 4070 — build on these)

- **Feasibility:** continuous feed transcribes the first word correctly (no leading loss); one long-lived `generate` ran the whole clip with VRAM 8.86→9.05 GB (bounded); silence → empty (`''`) tokens, no hallucination; the model **batches** output (holds an utterance's tail ~3 s through a pause), so **sentence punctuation — not VAD timing — is the reliable cut signal**.
- **Backpressure:** at 1× mic the input backlog sits flat at **~0.56 s** (model delay); the 4070 keeps up to **~2.5× over-feed**; past the ceiling the backlog grows **~2.4 s/wall-s, crossing 3 s in ~1 s**, then drains as fast once input slows. So healthy (0.56 s) vs overloaded (runaway) is cleanly separable at a **~3 s** lag threshold.
- **`split_sentences` is verified** (see Task 1): `'x. Ask'`→`(['x.'],'Ask')`, `'3.5 ml '`→`([],...)` (decimal not split), `'country.'`→`([],...)` (held for the long-silence flush).

## Global Constraints

- **Continuous input, no VAD gating** in always-stream mode: every audio buffer is fed to the current stream.
- **Finals cut on sentence-final punctuation** — `. ` / `! ` / `? ` (punctuation + whitespace; the trailing space avoids decimals like `3.5`), via `split_sentences`.
- **VAD = state only** in always-stream: a speech-start `speech_start` cue (rising edge) + the long-silence trigger. It does NOT gate the input.
- **Long silence (≥ 2.5 s)** → flush any pending un-punctuated text as a `result`, then restart the stream (`abort()` + `open_stream()`), bounding context/VRAM.
- **Long-speech safety net:** if continuous speech runs > ~4 min with no long pause, restart at the next sentence boundary (pending empty).
- **Backpressure:** track lag = `_fed_s − _delta_count*0.08`; healthy ~0.56 s; if **lag > 3.0 s**, degrade `_mode` to `"per_utterance"` for the rest of the session (flush pending, drop the always-stream, let the kept Phase 2 `_drive` run).
- **Reuse unchanged:** `VoxtralRealtimeStream` (`feed`/`drain`/`end`/`abort`/`open_stream`), the transport (`run_stream` task, `feed_stream`, `_h_asr_init`, close-abort), the `partial`/`result` wire events, the renderer. **Phase 2's `_drive` is KEPT (renamed `_drive_utterance`) as the per-utterance fallback** — not deleted.
- **`result` shape reused:** `{type:'result', text, startSample, durationMs, recognitionTimeMs}` — `startSample`/`durationMs`/`recognitionTimeMs` are approximate in always-stream mode.
- **Hardware envelope:** sustained RTF < 1, VRAM ≥ ~9 GB (documented, not enforced beyond backpressure).
- **Tests:** sidecar `cd sidecar && .venv/bin/python -m pytest`. GPU tests gated on `SOKUJI_RUN_GPU`. English-only comments. No renderer changes.

---

### Task 1: `split_sentences` helper

**Files:**
- Modify: `sidecar/sokuji_sidecar/voxtral_stream.py` (add the module-level helper)
- Test: `sidecar/tests/test_voxtral_stream.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `split_sentences(buffer: str) -> tuple[list[str], str]` — completed sentences (each ending `.!?`+whitespace, stripped) + the trailing remainder. Task 2 imports it into the engine.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_voxtral_stream.py`:

```python
def test_split_sentences():
    from sokuji_sidecar.voxtral_stream import split_sentences
    assert split_sentences("Ask what you do. Ask not ") == (["Ask what you do."], "Ask not ")
    assert split_sentences("hello wor") == ([], "hello wor")
    assert split_sentences("x. Ask") == (["x."], "Ask")          # delta straddling a boundary
    assert split_sentences("3.5 ml ") == ([], "3.5 ml ")         # decimal NOT split (no space after .)
    assert split_sentences("country.") == ([], "country.")       # no trailing space -> held for flush
    assert split_sentences("a. b! c? d") == (["a.", "b!", "c?"], "d")
    assert split_sentences("") == ([], "")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_voxtral_stream.py -k split_sentences -v`
Expected: FAIL — `ImportError: cannot import name 'split_sentences'`.

- [ ] **Step 3: Implement the helper**

In `sidecar/sokuji_sidecar/voxtral_stream.py`, add at module level (after the imports, before the class):

```python
import re

_SENT_END = re.compile(r"(.*?[.!?])\s")


def split_sentences(buffer):
    """Cut `buffer` into completed sentences (each ending in . ! ? followed by whitespace)
    and the trailing remainder. 'Ask what you do. Ask not ' -> (['Ask what you do.'],
    'Ask not '). No sentence end -> ([], buffer). Decimals ('3.5') don't split (the
    required trailing whitespace isn't there). A sentence with no trailing space yet is
    held in the remainder until the next delta brings the space (or the long-silence flush
    commits it)."""
    out = []
    while True:
        m = _SENT_END.match(buffer)
        if not m:
            return out, buffer
        out.append(m.group(1).strip())
        buffer = buffer[m.end():]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_voxtral_stream.py -k split_sentences -v`
Expected: PASS. Then the full file: `cd sidecar && .venv/bin/python -m pytest tests/test_voxtral_stream.py -v` → PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/voxtral_stream.py sidecar/tests/test_voxtral_stream.py
git commit -m "feat(sidecar): split_sentences helper (punctuation-based output segmentation)"
```

---

### Task 2: Always-stream engine path (default mode) + keep per-utterance as fallback

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (rename `_drive`→`_drive_utterance`; add `_vad_state`, `_drive_always`, `_flush_and_restart`, `_result_event`; rework `init_streaming`, `run_stream`, `_drive_once`)
- Test: `sidecar/tests/test_asr_engine.py` (migrate the Phase 2 streaming test to per-utterance mode; add the always-stream unit test)

**Interfaces:**
- Consumes: `split_sentences` (Task 1); `VoxtralRealtimeStream` via `self._backend.open_stream()` with `feed`/`drain`/`abort`; the existing `_init_vad`, `_vad`/`_window`/`_buf`, `_downsample_int16_to_f32_16k`, `TARGET_RATE`, `_resolve_streaming_backend`.
- Produces: `AsrEngine._mode` (`"always_stream"`|`"per_utterance"`), `_drive_always(send, int16_bytes)`, `_drive_utterance(send, int16_bytes)` (the old `_drive`), `_vad_state(samples) -> (had_speech, rising)`, `_flush_and_restart(send)`, `_result_event(text) -> dict`. Task 3 adds backpressure inside `_drive_always`; Task 4 drives this on a GPU.

- [ ] **Step 1: Write the failing tests (migrate the per-utterance test; add the always-stream test)**

In `sidecar/tests/test_asr_engine.py`:

(a) The existing `test_streaming_emits_speech_start_partials_result` exercises the per-utterance path. Make it set per-utterance mode explicitly. Change its engine setup so that after building `eng`, it sets `eng._mode = "per_utterance"` before driving. Concretely, in that test add `eng._mode = "per_utterance"` immediately after `eng.init_streaming(...)` (or after the engine is constructed in the test), and keep the rest. (If the test constructs the engine via a helper, set the attribute on the returned engine.)

(b) Append the always-stream unit test:

```python
def test_always_stream_feeds_all_and_cuts_on_punctuation(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine

    fed = {"n": 0}
    pending = {"deltas": []}

    class _FakeStream:
        def feed(self, samples): fed["n"] += len(samples)
        def drain(self):
            out, pending["deltas"] = pending["deltas"], []
            return out
        def abort(self): pass
        def end(self): return ""

    eng = AsrEngine()
    eng._mode = "always_stream"
    eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self: _FakeStream()})()
    eng._pending = ""; eng._utt_text = ""
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0
    eng._silence_samples = 0; eng._stream_speech_samples = 0
    # VAD stub: speech present, no rising edge, never long-silence
    monkeypatch.setattr(eng, "_vad_state", lambda s: (True, False))

    sent = []
    async def send(m): sent.append(m)
    buf = (b"\x00\x00" * 1600)        # one 100ms buffer (1600 int16 samples)

    # 1) a delta with no sentence end -> partial only, no result
    pending["deltas"] = ["Ask not "]
    asyncio.run(eng._drive_always(send, buf))
    assert fed["n"] == 1600                          # the buffer was fed (not gated)
    assert sent[-1] == {"type": "partial", "text": "Ask not"}
    assert not any(m["type"] == "result" for m in sent)

    # 2) a delta completing the sentence -> result + the remainder becomes the new partial
    pending["deltas"] = ["what you do. Ask "]
    asyncio.run(eng._drive_always(send, buf))
    results = [m for m in sent if m["type"] == "result"]
    assert results and results[-1]["text"] == "Ask not what you do."
    assert sent[-1] == {"type": "partial", "text": "Ask"}


def test_always_stream_long_silence_flushes_and_restarts(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine
    opened = {"n": 0}

    class _FakeStream:
        def feed(self, samples): pass
        def drain(self): return []
        def abort(self): pass
        def end(self): return ""

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _FakeStream()
    eng._backend = type("B", (), {"open_stream": lambda self: (opened.__setitem__("n", opened["n"] + 1) or _FakeStream())})()
    eng._pending = ""; eng._utt_text = "trailing words"   # un-punctuated pending
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0
    eng._silence_samples = int(2.5 * 16000)              # already at the long-silence threshold
    eng._stream_speech_samples = 0
    monkeypatch.setattr(eng, "_vad_state", lambda s: (False, False))   # silence

    sent = []
    async def send(m): sent.append(m)
    asyncio.run(eng._drive_always(send, b"\x00\x00" * 1600))
    results = [m for m in sent if m["type"] == "result"]
    assert results and results[-1]["text"] == "trailing words"   # un-punctuated text flushed
    assert opened["n"] == 1                                       # stream restarted
    assert eng._utt_text == "" and eng._pending == ""            # reset
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k "always_stream or emits_speech_start" -v`
Expected: FAIL — `_drive_always` / `_vad_state` not defined; the migrated per-utterance test fails until `_mode` is honored.

- [ ] **Step 3: Implement the always-stream path**

In `sidecar/sokuji_sidecar/asr_engine.py`:

(a) Add the `split_sentences` import at the top (with the other module imports): `from .voxtral_stream import split_sentences` — but import it lazily inside `_drive_always` to avoid importing torch at module load. Use `from .voxtral_stream import split_sentences` inside the method.

(b) **Rename** `_drive` → `_drive_utterance` (keep the body byte-for-byte; only the `def` name changes).

(c) Rework `init_streaming` to open the stream up front + initialize always-stream state + default mode. Replace the body after `self._language = language or None` with:

```python
        self._audio_q = _queue.Queue()
        self._mode = "always_stream"
        self._stream = self._backend.open_stream()   # always-stream: one long-lived session
        self._pending = ""           # un-segmented text accumulated from drain()
        self._utt_text = ""          # current sentence (the partial)
        self._partial_acc = []       # per-utterance fallback accumulator
        self._utt_start_sample = 0
        self._sample_cursor = 0
        self._utt_samples = 0        # per-utterance fallback (20s cap)
        self._silence_samples = 0    # consecutive silence (always-stream restart)
        self._stream_speech_samples = 0   # speech since last restart (4min safety)
        self._fed_s = 0.0            # audio seconds fed (backpressure, Task 3)
        self._delta_count = 0        # tokens drained (backpressure, Task 3)
        self._stop = False
```

(d) Make `run_stream` and `_drive_once` dispatch by mode. Replace `await self._drive(send, data)` in `run_stream` with:

```python
            if self._mode == "always_stream":
                await self._drive_always(send, data)
            else:
                await self._drive_utterance(send, data)
```
and replace `run_stream`'s tail (`if self._stream is not None: await self._finalize(send)`) with:

```python
        if self._mode == "always_stream":
            if self._utt_text:
                await send(self._result_event(self._utt_text))
        elif self._stream is not None:
            await self._finalize(send)
```
and in `_drive_once`, replace `await self._drive(...)` with the same mode dispatch:

```python
    async def _drive_once(self, send):
        """Test seam: drive exactly the buffers currently queued, once."""
        while not self._audio_q.empty():
            data = self._audio_q.get_nowait()
            if self._mode == "always_stream":
                await self._drive_always(send, data)
            else:
                await self._drive_utterance(send, data)
```

(e) Add the new methods (after `_drive_utterance`):

```python
    def _vad_state(self, samples):
        """Run silero VAD over `samples` for STATE only (always-stream): return
        (had_speech, rising_edge). Unlike _vad_events it does not gate input or emit
        per-utterance start/speech/end."""
        had_speech = False
        rising = False
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
        return had_speech, rising

    def _result_event(self, text):
        """A `result` envelope. startSample/durationMs are approximate in always-stream."""
        return {"type": "result", "text": text.strip(),
                "startSample": int(self._utt_start_sample),
                "durationMs": int(self._sample_cursor / TARGET_RATE * 1000),
                "recognitionTimeMs": 0}

    async def _flush_and_restart(self, send):
        """Flush any un-punctuated pending text as a final, then restart the stream
        (abort + reopen) — bounds context/VRAM and recovers cleanly during silence."""
        if self._utt_text:
            await send(self._result_event(self._utt_text))
        try:
            self._stream.abort()
        except Exception:
            pass
        self._stream = self._backend.open_stream()
        self._pending = ""
        self._utt_text = ""
        self._silence_samples = 0
        self._stream_speech_samples = 0

    async def _drive_always(self, send, int16_bytes):
        """Always-stream: feed every buffer (no gating); VAD only for the speech-start cue
        + the long-silence restart; drain -> accumulate -> cut finals on sentence punctuation."""
        from .voxtral_stream import split_sentences
        samples = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
        self._sample_cursor += len(samples)
        self._fed_s += len(samples) / TARGET_RATE
        self._stream.feed(samples)                       # continuous, never gated
        try:
            had_speech, rising = self._vad_state(samples)
        except Exception:                                # VAD failure -> degrade gracefully
            had_speech, rising = True, False             # assume speech; punctuation finals still work
        if rising:
            await send({"type": "speech_start"})
        if had_speech:
            self._silence_samples = 0
            self._stream_speech_samples += len(samples)
        else:
            self._silence_samples += len(samples)
        deltas = self._stream.drain()
        self._delta_count += len(deltas)
        if deltas:
            self._pending += "".join(deltas)
            sentences, remainder = split_sentences(self._pending)
            for s in sentences:
                await send(self._result_event(s))
            self._pending = remainder
            self._utt_text = remainder.strip()
            await send({"type": "partial", "text": self._utt_text})
        if getattr(self._stream, "aborted", False):      # generate died -> self-heal: flush + restart
            await self._flush_and_restart(send)
            return
        if self._silence_samples >= int(2.5 * TARGET_RATE):
            await self._flush_and_restart(send)
        elif self._stream_speech_samples >= 4 * 60 * TARGET_RATE and not self._pending:
            await self._flush_and_restart(send)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k "always_stream or emits_speech_start" -v`
Expected: PASS (the 2 always-stream tests + the migrated per-utterance test). Then the FULL `tests/test_asr_engine.py` → PASS (offline + transport tests unaffected; the GPU e2e test is updated in Task 4).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/tests/test_asr_engine.py
git commit -m "feat(sidecar): always-stream engine (continuous feed, punctuation finals, restart-on-silence); keep per-utterance as fallback"
```

---

### Task 3: Backpressure → degrade to per-utterance

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (`_drive_always`: lag check + degrade)
- Test: `sidecar/tests/test_asr_engine.py`

**Interfaces:**
- Consumes: `_drive_always`, `_fed_s`, `_delta_count`, `_mode`, `_result_event` (Task 2).
- Produces: when `lag = _fed_s − _delta_count*0.08 > 3.0`, `_mode` flips to `"per_utterance"`, the always-stream session is dropped, and pending text is flushed.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_asr_engine.py`:

```python
def test_backpressure_degrades_to_per_utterance(monkeypatch):
    import asyncio
    from sokuji_sidecar.asr_engine import AsrEngine

    class _SlowStream:      # never emits deltas -> processed audio stays 0 -> lag grows
        def feed(self, samples): pass
        def drain(self): return []
        def abort(self): pass

    eng = AsrEngine()
    eng._mode = "always_stream"; eng._src_rate = 16000
    eng._stream = _SlowStream()
    eng._backend = type("B", (), {"open_stream": lambda self: _SlowStream()})()
    eng._pending = ""; eng._utt_text = "held text"
    eng._sample_cursor = 0; eng._utt_start_sample = 0
    eng._fed_s = 0.0; eng._delta_count = 0
    eng._silence_samples = 0; eng._stream_speech_samples = 0
    monkeypatch.setattr(eng, "_vad_state", lambda s: (True, False))

    sent = []
    async def send(m): sent.append(m)
    buf = b"\x00\x00" * 16000     # 1s of audio per call
    # feed ~4s of audio with no deltas -> lag exceeds 3.0 -> degrade
    for _ in range(4):
        asyncio.run(eng._drive_always(send, buf))
    assert eng._mode == "per_utterance"                     # degraded
    assert eng._stream is None                              # always-stream session dropped
    assert any(m["type"] == "result" and m["text"] == "held text" for m in sent)  # pending flushed
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k backpressure -v`
Expected: FAIL — `_mode` stays `"always_stream"` (no lag check yet).

- [ ] **Step 3: Add the lag check to `_drive_always`**

In `_drive_always`, insert a backpressure check at the END of the method (after the silence/safety-restart block):

```python
        lag = self._fed_s - self._delta_count * 0.08          # ~0.56s healthy; >3s = can't keep up
        if self._mode == "always_stream" and lag > 3.0:
            if self._utt_text:
                await send(self._result_event(self._utt_text))
            try:
                self._stream.abort()
            except Exception:
                pass
            self._stream = None                               # per-utterance opens on next VAD start
            self._mode = "per_utterance"
            self._pending = ""
            self._utt_text = ""
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k "backpressure or always_stream" -v`
Expected: PASS (degrade test + the Task 2 always-stream tests still pass — their fakes emit deltas so lag stays low). Then full `tests/test_asr_engine.py` → PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/tests/test_asr_engine.py
git commit -m "feat(sidecar): backpressure degrades always-stream to per-utterance when the GPU falls behind"
```

---

### Task 4: GPU smoke (always-stream end-to-end)

**Files:**
- Test: `sidecar/tests/test_asr_engine.py` (update the gated `test_streaming_end_to_end_real_gpu` to assert always-stream behavior)

**Interfaces:**
- Consumes: the full always-stream path (Tasks 1-3) + a real GPU + the cached model + the `benchmark/test-speech-silence-speech.wav` clip.
- Produces: a gated test proving no leading loss, sentence finals, a restart at the long silence, VRAM bounded.

- [ ] **Step 1: Update the gated end-to-end test**

Replace the body of `test_streaming_end_to_end_real_gpu` in `sidecar/tests/test_asr_engine.py` with the always-stream flow (paced concurrent feeder; the `speech-silence-speech` clip is 24 kHz, so `init_streaming(sample_rate=24000)` and the engine downsamples):

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (uses cached Voxtral-Mini-4B-Realtime; needs CUDA)")
def test_streaming_end_to_end_real_gpu():
    import wave, asyncio, glob
    from huggingface_hub import snapshot_download
    snapshot_download("mistralai/Voxtral-Mini-4B-Realtime-2602",
                      ignore_patterns=["consolidated.safetensors", "*.gitattributes"])
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    wav = os.path.join(root, "benchmark", "test-speech-silence-speech.wav")
    if not os.path.exists(wav):
        wav = glob.glob(os.path.expanduser(
            "~/.cache/huggingface/hub/models--csukuangfj--sherpa-onnx-sense-voice*/snapshots/*/test_wavs/en.wav"))[0]
    w = wave.open(wav)
    sr = w.getframerate()
    pcm = w.readframes(w.getnframes())
    eng = AsrEngine()
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", sample_rate=sr, device="cuda")
    opens = {"n": 0}
    _orig = eng._backend.open_stream
    eng._backend.open_stream = lambda: (opens.__setitem__("n", opens["n"] + 1) or _orig())
    sent = []
    async def send(m): sent.append(m)
    step = int(0.1 * sr) * 2     # 100ms of int16 bytes
    async def feeder():
        for i in range(0, len(pcm), step):
            eng.feed_stream(pcm[i:i + step])
            await asyncio.sleep(0.1)
        eng.feed_stream(None)
    async def drive():
        await asyncio.gather(feeder(), eng.run_stream(send))
    asyncio.run(drive())
    results = [m["text"] for m in sent if m["type"] == "result"]
    full = " ".join(results).lower()
    assert results, "no finals produced"
    assert "ask" in full and "country" in full, f"unexpected: {results!r}"   # first word present, no leading loss
    print(f"always-stream e2e: {len([m for m in sent if m['type']=='partial'])} partials, "
          f"{len(results)} finals, restarts(open_stream calls)={opens['n']}")
    eng.close()
```

- [ ] **Step 2: Verify it skips without the flag**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k streaming_end_to_end -v` → `1 skipped`.

- [ ] **Step 3: Run it on the 4070 (model cached)**

Run: `cd sidecar && SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_asr_engine.py -k streaming_end_to_end -v -s`
Expected: PASS — prints partial/final counts + restart count; the finals contain "ask"/"country" (the first word is present — the leading-loss fix). The 2 s mid-clip silence should trigger ≥1 restart (`open_stream` called >1).

- [ ] **Step 4: Commit**

```bash
git add sidecar/tests/test_asr_engine.py
git commit -m "test(sidecar): always-stream end-to-end GPU smoke (no leading loss, sentence finals, restart-on-silence)"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Full sidecar pytest**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS (GPU-gated tests skip without their flag).

- [ ] **Step 2: Renderer vitest (unchanged contract — confirm no break)**

Run: `npm run test -- src/lib/local-inference/native/ src/services/clients/LocalNativeClient.test.ts`
Expected: PASS (the `partial`/`result` contract is unchanged, so these stay green).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit only if Steps 1-3 surfaced fixes**

If a fix was needed: `git add -A && git commit -m "test(native): green always-stream suites"`. Otherwise nothing to commit — skip.
