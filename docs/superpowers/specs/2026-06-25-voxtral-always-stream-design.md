# Native ASR: Voxtral Realtime — Always-Stream (option d) — Design

**Status:** PLANNED. Supersedes the VAD-input-gated streaming of Phase 2 for the `voxtral_realtime` backend.
**Branch:** `feat/native-asr-voxtral-always-stream` (to be cut from `feat/native-asr-voxtral-streaming`).
**Date:** 2026-06-25.
**Builds on:** Phase 2 streaming (`docs/superpowers/specs/2026-06-25-voxtral-realtime-streaming-design.md`).

## 1. Goal

Eliminate the **leading-word loss** in Phase 2 (the first ~0.25 s of each utterance is dropped because the
stream is only opened on the VAD speech-start *rising edge*, which lags the true onset). Switch to the
architecture the Realtime model was built for: **feed all audio continuously to one long-lived streaming
session** (no input gating), and use silero VAD + the model's own punctuation to segment the **output**
into per-sentence finals. This also removes Phase 2's per-utterance reset.

**Out of scope:** vLLM; any translation/TTS change (finals still feed the unchanged pipeline); the offline
path; the renderer wire/render contract (reused as-is). ASR streaming only.

## 2. Context: what Phase 2 gives us, and what changes

- **Phase 2** opens a fresh `VoxtralRealtimeStream` per utterance on the VAD `"start"` event and feeds only
  from that point (`asr_engine.py` `_drive`/`_vad_events`/`_finalize`). The rising edge lags the onset by
  `min_speech_duration` (~0.25 s) + silero detection latency → the first word(s) are never fed → dropped.
- **Reused unchanged:** the `VoxtralRealtimeStream` session (`voxtral_stream.py`) — it already supports
  continuous `feed()` / `drain()` / `end()`; the `STREAMING` flag + `open_stream()`; the transport
  `run_stream` asyncio task + `feed_stream` enqueue + the close-abort cleanup; the `partial`/`result` wire
  events; the renderer (`NativeAsrClient.onPartialResult`, `LocalNativeClient.partialUserItem`).
- **Changed:** the engine's streaming branch logic (`_drive`/`_vad_events`/`_finalize`) is reworked into the
  always-stream loop (§5). Phase 2's input-gated open/feed/finalize is superseded.

## 3. Spike findings (verified live on the RTX 4070 — the design is built on these)

A GPU spike fed a `speech-silence-speech` clip (9.69 s) continuously to ONE long-lived stream (never reset),
realtime-paced, logging each token's arrival time + VRAM:

- **Continuous input solves the leading loss.** The very first word transcribed correctly; the full final
  was the complete, correct transcript with no clipped beginning.
- **Stable + VRAM bounded.** One `generate` ran the whole clip with **VRAM 8.86→9.05 GB** (0.19 GB drift) —
  the model's sliding-window attention (text 4096 / encoder 750) holds it flat. No crash.
- **Silence emits empties, not hallucinations.** During the ~2 s mid-clip silence the model emitted empty
  (`''`) deltas and **no spurious text**, then resumed correctly on the second utterance.
- **Output timing does NOT cleanly align with utterance boundaries (the key finding).** The model *batches*:
  the last words of utterance 1 ("…your country.") were **held and flushed ~3.3 s after their audio**
  (through the silence), then utterance 2's "Ask" arrived **0.09 s later**. So there is no reliable *gap* in
  the output at a boundary, and "VAD endpoint + fixed delay" would chop the held tail.
- **The model's punctuation is clean and well-placed:** "…can do for you**. **Ask what you can do for your
  country**. **Ask not…". Sentence-final punctuation is the reliable segmentation signal — and yields
  translation-ideal sentence chunks.

A second **rate-limit (backpressure) spike** simulated slower GPUs by feeding faster than real time
(feed-rate R× ≈ a GPU with effective RTF ≈ 0.45·R at a 1× mic):

- At true 1× mic rate the input backlog sits **flat at the model's intrinsic ~0.56 s**. The 4070 keeps up
  even at **2.5× over-feed** (backlog ≤ 0.7 s) — under continuous streaming it batches more efficiently than
  the 0.45 RTF estimate, so its real ceiling is ~2.5×.
- **Past the ceiling (5× over-feed ≈ a GPU ~2.25× too slow) the backlog grows ~2.4 s per wall-second and
  crosses 3 s within ~1 s of sustained overload** — then **drains just as fast (~2.4 s/s) the moment the
  input slows** (RTF < 1). So a healthy session (~0.56 s, flat) is cleanly separable from an overloaded one
  (runaway), and a marginal machine recovers as soon as it gets pause-slack — exactly what degrading to
  per-utterance provides. This grounds the §7 backpressure threshold.

## 4. Decisions

1. **Continuous input, no VAD gating.** All audio is fed to the current stream. VAD no longer decides what
   the model hears — it only tracks speech/silence *state*.
2. **Finals are cut on sentence-final punctuation** (`. ` / `! ` / `? ` — punctuation followed by whitespace,
   which avoids decimals like `3.5`), not on VAD timing (misaligned by the model's hold/delay, §3).
3. **VAD long-silence (≥ 2.5 s) does two things:** (a) flush any pending un-punctuated text as a final
   (covers trailing-off utterances), and (b) restart the stream (`end()` + reopen) — a clean restart during
   silence loses no audio and caps per-stream context regardless of session length.
4. **Reuse `VoxtralRealtimeStream` as the per-stream-segment session;** the engine owns the continuous loop +
   segmentation. Fixed `num_delay_tokens` (480 ms) as Phase 2.
5. **Long-speech safety net:** if speech runs > ~4 min with no long pause, force a restart at the next
   sentence cut (avoids the >5.5-min sliding-window edge, unverified).
6. **Backpressure + graceful degradation (§7):** always-stream requires sustained RTF < 1; on hardware that
   can't keep up, the engine detects a growing input backlog and degrades to Phase 2's per-utterance mode for
   the rest of the session, rather than letting latency climb unboundedly.

## 5. Architecture

### 5.1 The always-stream loop (`asr_engine.py`, reworking the streaming branch)

`init_streaming` opens one `VoxtralRealtimeStream` up front (or on the first audio) and initializes
`_utt_text = ""`, `_sentence_re`, the VAD, a silence-duration counter, and a stream-age counter. The
`run_stream` asyncio task, per audio buffer pulled from the queue:

1. **Feed unconditionally:** downsample → `self._stream.feed(samples)` (no VAD gate).
2. **VAD state:** run silero VAD on the same samples; track `silence_ms` (reset on speech) and emit
   `speech_start` on a silence→speech rising edge (UI cue only).
3. **Drain + accumulate:** `for d in self._stream.drain(): self._pending += d`; then segment `self._pending`
   (§5.2), emitting `result`s for completed sentences and keeping the trailing remainder in `_utt_text`;
   emit `partial {text: _utt_text}` if it changed.
4. **Long silence (≥ 2500 ms) or stream-age > ~4 min:** flush `_utt_text` as a `result` if non-empty, then
   `self._stream.end()` (or `abort()`), `self._stream = self._backend.open_stream()`, reset counters. Keep
   feeding the new stream.

### 5.2 Sentence segmentation (the one tricky unit — its own helper)

A pure function `split_sentences(buffer: str) -> (list[str], str)` so it's unit-testable in isolation:

```python
import re
_SENT_END = re.compile(r"(.*?[.!?])\s")   # smallest chunk ending in . ! ? then whitespace

def split_sentences(buffer):
    """Cut `buffer` into completed sentences (each ending in .!? + whitespace) and the
    trailing remainder. 'Ask what you do. Ask not ' -> (['Ask what you do.'], 'Ask not ').
    A buffer with no sentence end -> ([], buffer). Decimals ('3.5') don't split (no space)."""
    out = []
    while True:
        m = _SENT_END.match(buffer)
        if not m:
            return out, buffer
        out.append(m.group(1).strip())
        buffer = buffer[m.end():]
```

The loop appends each completed sentence to `result`s, and `_utt_text = remainder.strip()` (the current
incomplete sentence shown as the partial). This correctly handles a single delta straddling a boundary
(`"country. Ask"` → final `"…country."`, partial `"Ask"`).

### 5.3 What's reused / unchanged

`VoxtralRealtimeStream` (feed/drain/end/abort), the `STREAMING` flag, `feed_stream`/`run_stream` wiring,
`_h_asr_init`'s streaming branch start, the close-abort cleanup, the `partial`/`result` wire events, and the
renderer. The `result` event keeps its shape (`text`, `startSample`, `durationMs`, `recognitionTimeMs` —
the latter best-effort/approximate in always-stream mode).

## 6. Error handling

- **Generate error mid-session:** the stream's `aborted` flag flips; the loop flushes `_utt_text` as a final
  and restarts the stream (self-heal) rather than dying.
- **Connection close:** the Phase 2 close-abort path (`AsrEngine.close()` ends the open stream + sentinel) is
  reused verbatim — no mid-utterance thread/VRAM leak.
- **VAD failure:** degrade gracefully — punctuation finals still work; only restart + un-punctuated-flush are
  lost (the long-speech safety net still caps context).
- **No-punctuation drift:** if the model never emits sentence-final punctuation (rare), the VAD-long-silence
  flush + the long-speech safety net guarantee finals still land.

## 7. Hardware envelope & backpressure

Always-stream is more throughput-hungry than Phase 2's per-utterance mode: it feeds and decodes
**continuously, including during silence** (the model emits ~12.5 tok/s of empty tokens through a pause, §3),
so it has **none of the "catch up during the user's pauses" slack** the per-utterance path enjoys. Sustained
GPU throughput is therefore the binding constraint.

**Requirements:**
- **VRAM ≥ ~9 GB** — the bf16 4B model + bounded sliding-window cache (independent of always-stream; <9 GB
  GPUs can't run the model at all without quantization).
- **Sustained RTF < 1** — the GPU must transcribe audio faster than it arrives. A live mic produces audio at
  exactly 1× real time, so the input queue stays empty iff RTF < 1. The dev 4070 is RTF ≈ 0.45 (~2.2× margin,
  measured). A GPU/CPU with RTF ≥ 1 cannot keep up: the backlog grows without bound and latency climbs.

**Backpressure + graceful degradation:** the engine monitors the input backlog — the `_audio_q` depth, or the
fed-audio-time minus processed-audio-time lag. On adequate hardware this sits near the model's ~0.5 s
intrinsic delay. If the backlog **grows monotonically past ~3 s** (a sustained sign that RTF ≥ 1 on this
machine), the engine **degrades to Phase 2's per-utterance mode** for the rest of the session — per-utterance
reclaims pause-slack and bounds latency, trading the leading-word fix back for keeping up. This makes
always-stream the **default on capable GPUs and a self-downgrading choice on marginal ones**, not a
4070-only design. (The ~3 s threshold + the backlog-growth rate are confirmed by the rate-limit spike, §3.)

## 8. Testing

- **Unit — `split_sentences`** (`test_voxtral_stream.py` or a new `test_segmentation.py`): `"a. b. "` →
  `(["a.", "b."], "")`; `"hello wor"` → `([], "hello wor")`; `"x. Ask"` → `(["x."], "Ask")`; `"3.5 ml "` →
  `([], "3.5 ml ")` (decimal not split).
- **Unit — engine always-stream** (`test_asr_engine.py`, fake stream + VAD stub, no GPU): every buffer is fed
  (assert the fake stream's fed-sample count == all input, i.e. NOT gated); deltas accumulate into `partial`;
  a delta with `". "` cuts a `result` + carries the remainder; a VAD long-silence flushes a pending final +
  opens a new stream (assert `open_stream` called twice).
- **GPU smoke (`SOKUJI_RUN_GPU`)** — the `speech-silence-speech` clip, paced + concurrent (per Phase 2): the
  **first word is present** (no leading loss), ≥1 sentence-level `result` per half, a stream restart occurs
  at the long silence, and VRAM stays ~9 GB. This is the spike, frozen.
- Gates: `pytest` (sidecar) + `vitest` (renderer, unchanged); `npm run build`.

## 9. Out of scope (YAGNI)

- No vLLM; no translation/TTS change; no offline-path or renderer-contract change.
- No abbreviation-aware sentence splitting (`Mr.`/`Dr.`) — spoken-ASR transcripts rarely hit it; the
  whitespace rule already excludes decimals. Revisit only if it misfires in practice.
- No per-token timestamps / word-level timing (the `result` `durationMs`/`startSample` are approximate).
- No configurable silence/restart thresholds in the UI (fixed: 2.5 s restart, ~4 min safety net).

## 10. Files touched

- `sidecar/sokuji_sidecar/asr_engine.py` — rework the streaming branch into the always-stream loop
  (continuous feed, VAD state, drain+segment, restart-on-long-silence); `split_sentences` helper (here or in
  `voxtral_stream.py`). The offline path stays unchanged.
- `sidecar/sokuji_sidecar/voxtral_stream.py` — only if `abort()` needs a non-blocking variant for restart
  (it already exists from Phase 2's final fix).
- `sidecar/tests/test_asr_engine.py`, `sidecar/tests/test_voxtral_stream.py` (or `test_segmentation.py`) —
  the `split_sentences` unit tests, the always-stream engine unit test, and the updated GPU smoke.
- No renderer changes (the `partial`/`result` contract is unchanged).
