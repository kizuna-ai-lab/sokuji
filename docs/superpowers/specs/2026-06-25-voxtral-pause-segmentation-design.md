# Native ASR: Voxtral Realtime — Pause-Driven Segmentation (Plan A) — Design

**Status:** PLANNED. Reworks the always-stream segmentation that just landed
(`2026-06-25-voxtral-always-stream-design.md`).
**Branch:** `feat/native-asr-voxtral-always-stream`.
**Date:** 2026-06-25.

## 1. Goal

Make the always-stream Voxtral ASR commit finals (→ translation) **promptly, completely, and under the
user's control**, fixing three coupled problems found in real use:

1. **Slow/clumpy translation.** Finals only fire on a hardcoded `_silence_samples >= 2.5s` counter, so
   translation arrives ~3.9 s after you stop (silero's 1.4 s endpoint + the 2.5 s counter on top).
2. **Tail-hold.** The last word of an utterance is never in the partial — it appears only when the *next*
   utterance starts. (The model holds the final token until the generate terminates or new audio arrives.)
3. **The "Min Silence Duration" slider is masked.** It reaches silero, but the hardcoded 2.5 s counter
   dominates segmentation, so the slider (labeled *"split speech segments faster"*) barely changes timing.

**Out of scope:** vLLM, TTS, the translation model; the offline path; the transport/wire/renderer contract
(reused unchanged); changing the global VAD defaults (the 1.4 s default stays — we only make it *effective*).

## 2. Context: the VAD chain + what always-stream does today

The VAD settings are fully plumbed: UI sliders (`LocalSettingsControls.tsx`) → store
(`vadMinSilenceDuration` default **1.4 s**, `settingsStore.ts:373`) → `LocalNativeClient` →
`NativeAsrClient` (`asr_init` msg) → backend `_h_asr_init` → `_init_vad` → `silero_vad.min_silence_duration`.

But `_drive_always` (the just-landed always-stream loop) ignores silero's endpoint for segmentation: it runs
its own `_vad_state` (rising edge + per-buffer speech) and cuts on `_silence_samples >= int(2.5*TARGET_RATE)`
(`asr_engine.py:356`), plus a `split_sentences` punctuation cut that never fires (the model emits commas but
no sentence-final period). So segmentation is governed by the 2.5 s constant, not the user's slider.

## 3. Spike findings (verified live on the RTX 4070)

- **Soft-flush is insufficient (the decisive finding).** Feeding the model's `_right_pad` (17×1280 = 21760
  samples ≈ 1.36 s of silence) mid-stream *without* ending flushed most of a held tail (`"do for your"`) but
  **kept holding the very last word (`"country."`)**; that word only emerged when the next utterance's audio
  arrived. A *non-terminating* generate always holds the final token until it terminates or sees real new
  audio. **So only `end()` (which terminates the generate) yields a complete final.**
- **`end()` flushes the complete tail** — it appends `_right_pad`, drains to the generate's completion, and
  returns the full transcript including the held last word. (Proven; `VoxtralRealtimeStream.end()`.)
- **The held tail is not recoverable any other way** — two spikes confirmed silence padding alone (even ~2 s)
  does not commit the last token.

## 4. Decisions

1. **Segment on silero's endpoint, not a constant.** The pause-cut fires on silero's speech→silence
   transition (`is_speech_detected()` True→False), which is governed by the user's `vadMinSilenceDuration`.
   The slider becomes the real, live pause threshold (0.05–2.0 s). Remove the `_silence_samples` counter, the
   2.5 s constant, and the 4-min safety.
2. **Pause-cut = `end()` + reopen.** On the endpoint, `end()` the current stream (flushes the **complete**
   tail → the last word lands at the pause, not at the next utterance) and emit `end()`'s full transcript as
   the `result`. Then `open_stream()` a fresh session and keep feeding. Continuous feed is preserved, so no
   leading loss (the reopen happens during the pause; the next utterance is captured from its first word).
3. **The audio queue is the during-end buffer.** `end()` runs in the asyncio executor (~0.6–1 s, doesn't
   block the loop logic, but the loop awaits it); incoming audio accumulates in `_audio_q` meanwhile and is
   fed to the new stream once it opens. Nothing is dropped; if the user resumes mid-`end()` (rare — they just
   paused ≥1.4 s) that speech is delayed ~1 s, never lost. Serial: one utterance fully finalizes before the
   next begins, so the renderer never sees interleaved items.
4. **Drop punctuation cutting from the hot path.** `split_sentences` never fires for this model and a
   mid-stream punctuation cut would have the same tail-hold problem. The endpoint is the sole cut.
   `split_sentences` stays as a tested utility (unused) — optional later cleanup.
5. **Keep one safety net:** a `_max_speech_samples` cap (~20 s of unbroken speech with no endpoint) forces an
   `end()`+reopen so run-on speech can't starve translation or grow VRAM. A bound, not a tuning knob.
6. **Min-utterance guard:** only `end()`+reopen on an endpoint if the stream produced text (`_pending`
   non-empty) — avoids empty finals + wasted reopens on a speech blip that transcribed to nothing.
7. **Default stays 1.4 s** (global; untouched so other models' endpointing is unaffected). The user tunes the
   Voxtral pause live via the now-functional slider.

## 5. Architecture

### 5.1 `_vad_state` returns the falling edge (`asr_engine.py`)

Today `_vad_state(samples) -> (had_speech, rising)`. Extend it to `-> (had_speech, rising, falling)`, where
`falling` is True on any window where `is_speech_detected()` goes True→False this buffer (silero's endpoint,
governed by `min_silence_duration`). Mirrors the rising-edge logic already in the method.

### 5.2 Reworked `_drive_always` loop

Per audio buffer:
1. Downsample; `self._stream.feed(samples)` (continuous, never gated); `self._fed_s += …` (backpressure,
   unchanged); `self._speech_samples += len(samples)` while `had_speech`.
2. `had_speech, rising, falling = self._vad_state(samples)` (VAD-failure try/except unchanged → treat as
   speech). Emit `speech_start` on `rising` (UI cue).
3. Drain → `self._pending += "".join(deltas)`; emit `partial {text: self._pending.strip()}`.
4. `aborted` self-heal (unchanged): `getattr(stream,"aborted",False)` → end+reopen + return.
5. **Pause-cut:** if `(falling or self._speech_samples >= 20*TARGET_RATE)` **and** `self._pending.strip()`:
   - `final = await loop.run_in_executor(None, self._stream.end)` (complete tail; queue backs up meanwhile).
   - `if final.strip(): await send(self._result_event(final))`.
   - `self._stream = self._backend.open_stream()`; reset `self._pending=""`, `self._speech_samples=0`.

`run_stream`, `_drive_once`, `init_streaming` mode dispatch, the per-utterance fallback (`_drive_utterance`),
and the backpressure degrade (lag > 3 s, Task 3) are unchanged. `init_streaming` drops `_silence_samples` /
`_stream_speech_samples`; adds `_speech_samples` and keeps `_pending`.

### 5.3 The result is `end()`'s transcript, not `_pending`

`_pending` (the streamed partial) is missing the held tail; `end()` returns the authoritative complete text.
The `result` carries `end()`'s return. The renderer's `LocalNativeClient.onAsrResult` replaces the in-progress
item's text with it, so the held tail (e.g. `"… do for your country."`) appears at the pause.

## 6. Error handling

- **`end()` raises / times out:** wrap the executor call; on failure log, still `open_stream()` + reset so
  the session self-heals (drop that utterance's final rather than wedging).
- **Connection close mid-end:** `AsrEngine.close()` (reused) aborts the open stream + sentinel; an in-flight
  executor `end()` completes or is abandoned with the threads joined.
- **VAD failure:** `_vad_state` try/except → treat as speech (no false endpoint); the 20 s cap still bounds.
- **Backpressure:** unchanged — lag > 3 s degrades to per-utterance (which reclaims pause-slack).

## 7. Testing

- **Unit (`test_asr_engine.py`, fake stream + VAD stub, no GPU):**
  - `_vad_state` returns `falling=True` on a True→False transition.
  - Endpoint with `_pending` non-empty → `end()` called once, `open_stream()` called once, the `result` text
    equals the fake `end()`'s return (the complete tail, not `_pending`).
  - Endpoint with empty `_pending` → no cut, no reopen (min-utterance guard).
  - 20 s of continuous speech with no endpoint → forced end+reopen.
  - During the awaited `end()`, queued buffers feed the NEW stream after reopen (assert no buffer dropped).
  - Backpressure degrade test (Task 3) still green.
- **GPU smoke (`SOKUJI_RUN_GPU`)** — the `speech-silence-speech` clip: assert the **last word of utterance 1
  appears in utterance 1's final** (not on utterance 2) — i.e. the final contains the complete first sentence
  — proving the tail-hold fix; finals are cut at the silero endpoint; first word present (no leading loss).
- Gates: `pytest` (sidecar) + `vitest` (renderer, unchanged); `npm run build`.

## 8. Out of scope (YAGNI)

- No overlap/2-stream concurrency (the serial queue-buffer is enough); no changes to global VAD defaults; no
  UI changes (the existing slider is reused); no punctuation/clause cutting; no per-token timestamps.

## 9. Files touched

- `sidecar/sokuji_sidecar/asr_engine.py` — `_vad_state` (+falling edge); `_drive_always` (endpoint→end+reopen,
  remove `_silence_samples`/2.5 s/4-min/punctuation-cut, add `_speech_samples` 20 s cap + min-utterance
  guard); `init_streaming` state init. Offline path + `_drive_utterance` + backpressure unchanged.
- `sidecar/tests/test_asr_engine.py` — update the always-stream unit tests (endpoint-based) + the GPU smoke
  (tail-hold assertion). The long-silence/punctuation tests from the prior design are replaced.
- No renderer changes (the `partial`/`result` contract + the VAD plumbing are already correct).
