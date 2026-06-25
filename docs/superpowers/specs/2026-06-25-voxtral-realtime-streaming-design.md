# Native ASR: Voxtral Mini 4B Realtime — Continuous Streaming (Phase 2) — Design

**Status:** PLANNED. Builds on Phase 1 (offline-segment backend, landed on `feat/native-asr-voxtral-realtime`).
**Branch:** `feat/native-asr-voxtral-streaming` (to be cut from `feat/native-asr-voxtral-realtime`).
**Date:** 2026-06-25.
**Phase 1 spec:** `docs/superpowers/specs/2026-06-25-voxtral-realtime-native-sidecar-asr-design.md`.

## 1. Goal

Deliver the realtime payoff that motivated choosing the Realtime variant: **continuous, low-latency
streaming ASR** in the native sidecar. As the user speaks, emit incremental (`partial`) transcripts
~480 ms behind the audio, then a committed `result` at each utterance boundary — using the model's
experimental transformers streaming API (`is_streaming` chunks + `TextIteratorStreamer` +
`num_delay_tokens` + per-stream padding cache).

**Explicitly out of scope:** vLLM; any change to the translation or TTS stages (only the final
utterance enters that pipeline, exactly as today); a user-facing delay slider; per-word timestamps;
the WebGPU LOCAL_INFERENCE path. This is LOCAL_NATIVE ASR only.

## 2. Context: what we already have

- **Phase 1** shipped `VoxtralRealtimeBackend` (`backends.py`), GPU bf16, run **offline per VAD
  segment** through the synchronous engine seam. The offline `transcribe()` stays — it backs the GPU
  smoke and is a fallback. Phase 2 adds a *streaming* path alongside it; it does not replace it.
- **The engine seam is synchronous.** `AsrEngine.feed(int16_bytes)` returns a *list* of events that
  the transport sends (`server.py` `_conn`: `for out in feeder(data): await conn.send(out)`). A
  threaded `TextIteratorStreamer` emits tokens from a background thread over hundreds of ms, so the
  sync `feed()→list` contract cannot carry streaming output.
- **The renderer already renders interim transcripts — on the WebGPU path.** `AsrEngine.ts`
  (LOCAL_INFERENCE) has `onPartialResult` + a `partial` event; `cohere-transcribe-webgpu` /
  `voxtral-3b-webgpu` workers emit token-by-token `partial`s via `TextStreamer`; and
  `LocalInferenceClient.ts` renders an in-progress **`partialUserItem`** that updates then finalizes.
  **The native path does not:** `NativeAsrClient` exposes only `onResult`/`onSpeechStart`, and
  `LocalNativeClient.onAsrResult` creates a *completed* user item per final. Phase 2 brings the native
  path to parity by mirroring the existing `partialUserItem` pattern — it does not invent new UI.
- **The existing WebGPU "streaming" is per-segment, not continuous** (VAD waits for the utterance to
  end, then streams the *decode*). Phase 2 is genuinely continuous (partials *while* speaking), which
  is the reason the Realtime model was chosen and what the WebGPU path cannot do.

## 3. Verified facts (from live exploration)

Confirmed in the sidecar venv (transformers `5.13.0.dev0`) + by reading the model doc and the codebase:

- `transformers` ships a **documented (experimental) streaming example** for
  `VoxtralRealtimeForConditionalGeneration` (model doc `voxtral_realtime`, "Streaming Transcription",
  flagged *"experimental and the API is subject to change"*). Its shape:
  ```python
  first = processor(audio[:processor.num_samples_first_audio_chunk],
                    is_streaming=True, is_first_audio_chunk=True, return_tensors="pt")
  def input_features_generator():
      yield first.input_features
      # then, per chunk: processor(audio[start:end], is_streaming=True,
      #                            is_first_audio_chunk=False).input_features
      ...
  streamer = TextIteratorStreamer(processor.tokenizer, skip_special_tokens=True)
  Thread(target=model.generate, kwargs={
      "input_ids": first.input_ids, "input_features": input_features_generator(),
      "num_delay_tokens": first.num_delay_tokens, "streamer": streamer}).start()
  for text_chunk in streamer: ...   # partials arrive here
  ```
  `generate` consumes a **generator** for `input_features` — the basis for feeding *live* audio (the
  generator blocks for the next chunk instead of reading a complete buffer). The `VoxtralRealtimeProcessor`
  `__call__` already takes `is_streaming` / `is_first_audio_chunk` (Phase 1 §0 confirmed the processor
  surface). `config.default_num_delay_tokens = 6` (= 6 × 80 ms = 480 ms).
- **Wire/transport** (`server.py`): after `asr_init`, `conn.ctx["on_binary"] = eng.feed`; binary
  frames route to the feeder; connection close calls `eng.close()` (frees VRAM) only for the
  ASR-owning connection.
- **Renderer surface**: `NativeAsrClient.feedAudio(Int16)` → `ws.send(buffer)`; `onMessage` dispatches
  id-less `result`/`speech_start`. `LocalInferenceClient.partialUserItem` is the interim→final pattern
  to mirror in `LocalNativeClient`.

## 4. Decisions

1. **Continuous streaming** (not per-segment token-streaming). Partials appear ~480 ms behind speech,
   while talking — the realtime payoff.
2. **Transport = Approach A: engine owns an asyncio task + audio queue.** At `asr_init`, if the resolved
   backend is streaming-capable, `on_binary` becomes a non-blocking enqueue and a long-lived asyncio
   task (holding `conn.send`) owns the streaming loop and pushes events. The experimental streaming API
   is isolated inside the backend; VAD + transport stay in the engine where the offline path lives.
   (Rejected: B — backend-owned threads bridged to the engine, more coupling; C — synchronous
   chunk-stepping, fights the autoregressive `generate`.)
3. **VAD = endpoint detector, not a recognition gate.** silero VAD marks speech-start (open a stream)
   and speech-end/silence (finalize + reset). The streaming model runs continuously *within* an
   utterance. A max-utterance cap (~20 s) forces periodic finalize + reset to bound VRAM even if no
   endpoint fires.
4. **Partials are display-only.** Only the VAD-endpointed **final** enters the existing
   translation→TTS pipeline — so translation/TTS are untouched (scope constraint honored structurally).
5. **Fixed delay** `num_delay_tokens = 6` (480 ms, the recommended sweet spot). Not exposed in the UI.
6. **Per-utterance stream session** owns the padding cache + KV and frees them on `end()` — this is
   what bounds VRAM across a long conversation.
7. **Promote the catalog row to `recommended=True`** (both catalogs) — Phase 1 set `False` pending
   exactly this.

## 5. Architecture

### 5.1 Streaming backend (`sidecar/sokuji_sidecar/backends.py` + a stream helper)

`VoxtralRealtimeBackend` gains a class flag `STREAMING = True` and `open_stream() -> VoxtralRealtimeStream`.
The `VoxtralRealtimeStream` session (a focused new unit — likely its own module
`voxtral_stream.py` to keep `backends.py` small) encapsulates the experimental API:

- A thread-safe **audio queue** (16 kHz float32 pushed by the engine).
- An **`input_features_generator`** adapted from the doc example to read *live*: it blocks until the
  next chunk's `num_samples_per_audio_chunk` samples are available, yields that chunk's features
  (`is_first_audio_chunk` only on the first), and stops when an end-of-utterance sentinel is enqueued
  (applying the model's right-padding so the tail tokens flush).
- A `TextIteratorStreamer` and the `generate(...)` call on a worker `Thread`, wired with the first
  chunk's `input_ids` + `num_delay_tokens`.

Interface: `feed(samples_f32_16k)` (enqueue), `text_deltas()` (iterate `TextIteratorStreamer` → token
strings; drained by the engine), `end() -> str` (enqueue sentinel, join the thread, return the final
full text, free the cache). One session per utterance.

Open items the §6 spike must close (the API is experimental): the exact processor chunk attributes
(`num_samples_first_audio_chunk`, `num_samples_per_audio_chunk`, `num_mel_frames_first_audio_chunk`,
`audio_length_per_tok`, `num_right_pad_tokens`, `raw_audio_length_per_tok`); that `generate` pulls the
`input_features` generator **lazily** (so live feeding works, not eager drain); how end-of-utterance
flushes the final tokens (right-padding); and the dtype cast on each chunk's `input_features`.

### 5.2 Streaming engine path (`sidecar/sokuji_sidecar/asr_engine.py`)

The engine branches on `backend.STREAMING`. Offline backends keep the **unchanged** synchronous
`feed()→list` path. For a streaming backend, an asyncio task (started by the transport, §5.3) runs:

1. Pull audio bytes from the queue → `_downsample_int16_to_f32_16k` (existing) → 16 kHz float32.
2. Run silero VAD (existing 512-sample windows) for endpointing.
3. On speech-start: emit `speech_start`; `open_stream()`.
4. During speech: `stream.feed(samples)`; concurrently drain `stream.text_deltas()` and emit
   `partial {text}` with the accumulated text (~480 ms latency).
5. On VAD silence (endpoint) or the max-utterance cap: `final = stream.end()`; emit `result` (final,
   reusing the existing `result` shape — `text`, `startSample`, `durationMs`, `recognitionTimeMs`);
   reset for the next utterance.

Bridging the blocking `TextIteratorStreamer` reads into asyncio uses `asyncio.to_thread` (or the
streamer's `timeout`) — pinned by the spike. `close()` cancels the task, ends any open session, frees
VRAM (extends the Phase 1 `close()`).

### 5.3 Transport (`sidecar/sokuji_sidecar/server.py`)

At `asr_init`, the handler checks whether the resolved backend is `STREAMING`. If so: set
`on_binary` to a non-blocking enqueue into the engine's audio queue (returns no events), and
`asyncio.create_task(...)` the engine's streaming loop, passing `conn.send`. The loop pushes
`speech_start`/`partial`/`result`/`error` itself. Non-streaming backends keep the current
`on_binary = eng.feed` sync path verbatim. Connection close cancels the task before `eng.close()`.
Add nothing to the synchronous dispatch; the streaming task is the only new control flow.

### 5.4 Wire protocol + renderer

- **`nativeProtocol.ts`**: add `AsrPartialMsg { type: 'partial'; text: string }` to `ServerMsg`.
- **`NativeAsrClient`**: add `onPartialResult: ((text: string) => void) | null`; in `onMessage`,
  dispatch id-less `partial` → `onPartialResult(msg.text)` (alongside the existing id-less `result`).
- **`LocalNativeClient`**: mirror `LocalInferenceClient`'s `partialUserItem`:
  - `this.asr.onPartialResult = (text) => this.onAsrPartial(text)` in `connect()`.
  - `onAsrPartial(text)`: if no `partialUserItem`, create an `in_progress` user item
    (`formatted.transcript = text`) and emit; else update its transcript and emit with a delta. **No**
    pipeline job.
  - `onAsrResult(final)`: if a `partialUserItem` exists, finalize it (`status='completed'`,
    `transcript=final`), clear it, emit; else create a completed item (back-compat with offline
    backends). Then run the existing translation job — unchanged.
  - `disconnect()`/`reset()` clear `partialUserItem`.

### 5.5 Catalog

Set `recommended=True` for `voxtral-mini-4b-realtime` in `catalog.py` and `nativeCatalog.ts` (and
update the Phase 1 row tests `recommended is False` → `True`). Ordering unchanged (`sort_order`/
`sortOrder` 9).

## 6. Validation spike (de-risker — run FIRST, the API is experimental)

A `SOKUJI_RUN_GPU`-gated spike that proves the live-streaming adaptation before any engine/transport
wiring:

1. Drive `VoxtralRealtimeStream` against a real clip fed in small chunks (simulating live audio): assert
   `text_deltas()` yields growing partials *before* `end()`, and `end()` returns a correct full
   transcript matching the Phase 1 offline result on the same clip.
2. Confirm `generate` consumes the `input_features` generator **lazily** (feed a chunk, observe a
   partial, feed more — not an eager up-front drain), and that the processor chunk attributes (§5.1)
   exist with the expected meaning.
3. Measure **first-partial latency** (target ≈ 480 ms behind the fed audio) and **VRAM across several
   utterances** (open/end repeatedly → no growth; peak ≈ Phase 1 ~10 GB).

The spike's findings pin §5.1/§5.2 (final code shape, the to_thread bridge, the end-of-utterance flush).

## 7. Testing

- **Unit (sidecar, no GPU):** a fake stream session (a scripted `TextIteratorStreamer` stand-in) drives
  the engine streaming path → assert ordered `speech_start` → N×`partial` (monotonically growing text)
  → `result`; a VAD endpoint finalizes; the next utterance opens a fresh session (reset/cache-free
  called). Transport: a fake `conn` asserts the streaming task pushes `partial`/`result` async and that
  a non-streaming backend still uses the sync `feed()→list` path. A `partial` message-shape test.
- **Renderer (vitest):** `NativeAsrClient` dispatches `partial`→`onPartialResult` and id-less
  `result`→`onResult`. `LocalNativeClient`: partials create/update ONE `in_progress` item and run NO
  job; the `result` finalizes that same item and runs the translation job exactly once (mirror the
  `LocalInferenceClient` partial tests). `catalog`/`nativeCatalog` tests updated to `recommended` true.
- **GPU smoke (`SOKUJI_RUN_GPU`):** stream a real multi-utterance clip end-to-end → partials precede
  each final, finals non-empty, first-partial latency ≈ 480 ms, VRAM bounded across utterances.
- Gates: `pytest` (sidecar) + `vitest` (renderer); `npm run build` for renderer wiring.

## 8. Out of scope (Phase 2 / YAGNI)

- **No vLLM** (Phase 1 §0 rejected it; same here).
- **No translation/TTS change** — only finals enter that pipeline, unchanged. Partials are display-only.
- **No delay slider / configurability** — fixed `num_delay_tokens=6` (480 ms).
- **No per-word timestamps, no diarization.**
- **No change to the offline `transcribe()`** (kept for the GPU smoke + as a fallback) or to any other
  backend / the WebGPU LOCAL_INFERENCE path.

## 9. Files touched (Phase 2)

- `sidecar/sokuji_sidecar/backends.py` — `STREAMING` flag + `open_stream()` on `VoxtralRealtimeBackend`.
- `sidecar/sokuji_sidecar/voxtral_stream.py` (new) — `VoxtralRealtimeStream` session.
- `sidecar/sokuji_sidecar/asr_engine.py` — streaming branch (asyncio loop, VAD endpointing, emit
  `partial`/`result`); offline path unchanged.
- `sidecar/sokuji_sidecar/server.py` — `asr_init` wires the streaming task for streaming backends.
- `sidecar/sokuji_sidecar/catalog.py` — `voxtral-mini-4b-realtime` `recommended=True`.
- `sidecar/tests/test_voxtral_stream.py` (new), `test_asr_engine.py`, `test_server_*.py`,
  `test_catalog.py` — unit tests + the GPU spike/smoke.
- `src/lib/local-inference/native/nativeProtocol.ts` — `AsrPartialMsg`.
- `src/lib/local-inference/native/NativeAsrClient.ts` — `onPartialResult` + `partial` dispatch.
- `src/services/clients/LocalNativeClient.ts` — `partialUserItem` interim→final.
- `src/lib/local-inference/native/nativeCatalog.ts` — `recommended: true`.
- renderer tests: `NativeAsrClient.test.ts`, `LocalNativeClient.test.ts`, `nativeCatalog.test.ts`.
