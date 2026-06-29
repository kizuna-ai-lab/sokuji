# Native TTS — Renderer Integration, Plan A (Design)

**Date:** 2026-06-29
**Status:** Design (approved in brainstorming; pending spec review → implementation plan)
**Depends on:** the sidecar TTS stage (`docs/superpowers/specs/2026-06-29-native-tts-backend-design.md`, implemented `fb91c1a0..8fea8ec6`). Tracking: issue #129; relates to #261 (per-stage pipeline).

## Summary

Wire the renderer (TypeScript) to the rewritten sidecar TTS protocol and bring native TTS to full parity with the WASM (`LocalInferenceClient`) path. This **Plan A** covers: the required protocol migration (the sidecar rewrite changed the wire messages and currently breaks the existing renderer client), intra-utterance **streaming** playback, the **resolved perf badge** (matching ASR/translate), **MOSS-Nano** selectability in the catalog, and full-parity playback (sentence-split + karaoke + replay). The **voice-clone UX** (reference-audio upload/record + `set_voice` wiring) is the deferred **Plan B**.

## Context — what exists, and what the sidecar rewrite broke

A native-TTS renderer path already exists and previously worked for piper:
- `NativeTtsClient` (one-shot `init`/`setReferenceVoice`/`generate`/`dispose`), `nativeCatalog` piper voice registry (`NATIVE_TTS_BY_LANG`, `nativeTtsCards`, `hasNativeTts`, `resolveNativeTts`), `LocalNativeSettings.ttsModel`/`ttsSpeed`, the TTS card group in `NativeModelManagementSection`, `TtsSpeedControl`, and the readiness gate (`requiredNativeModels`).
- `LocalNativeClient.runJob` already calls `tts.generate(...)` → `float32ToInt16(resampleFloat32(...,24000))` → `emit(item, {audio:int16})` → `ModernAudioPlayer`.

**The break:** the sidecar TTS rewrite (`fb91c1a0..8fea8ec6`) replaced the generic `init`/`generate` handlers with `tts_init`/`tts_generate`/`tts_chunk`/`tts_done`/`tts_cancel`. `NativeTtsClient` still sends `{type:'init'}`/`{type:'generate'}` → now "unknown message type" → **the native TTS path is currently broken.** Plan A's protocol migration is therefore required, not optional.

## Goals

- Restore native TTS against the new protocol (`tts_init`/`tts_generate`), and add `tts_chunk`/`tts_done` streaming + `tts_cancel`.
- Surface a `ttsResolved` perf badge (device/RTF/memory/fallback) like ASR/translate.
- Make MOSS-Nano selectable in the renderer catalog (streaming/clones-capable; preset voice in Plan A).
- Full WASM-parity playback in `LocalNativeClient`: sentence-split, karaoke segments, replay buffer, real-time deltas.

## Non-goals (Plan B / later)

- Voice-clone UX: the capability-driven Voice section (MOSS reference-audio upload/record + reference-audio storage + `set_voice` on connect + the `clones` capability gate). The `clones` flag is plumbed in Plan A but dormant.
- New TTS engines beyond MOSS-Nano + the existing piper voices.

## Architecture

```
Settings (NativeModelManagementSection): TTS card group + ttsResolved perf badge
        │ select tts model
LocalNativeClient (IClient)
   ├─ connect(): tts.init(model) → store.setTtsResolved(resolved)        [NEW: was discarded]
   └─ runJob(): split → per-sentence synth (one-shot|streaming) → karaoke + replay + delta → ModernAudioPlayer
NativeTtsClient (WS)
   ├─ tts_init   → ready{sampleRate,backend,device,computeType,rtf,streaming,clones,memoryBytes,fallbackReason}
   ├─ tts_generate → one-shot: result + binary PCM   |   streaming: tts_chunk*(binary) + tts_done
   └─ tts_cancel (on stop/interrupt)
nativeProtocol.ts : + TtsChunkMsg / TtsDoneMsg ; ReadyMsg gains streaming?/clones?
nativeModelStore  : + ttsLoading / ttsResolved / setTtsResolved / useNativeTtsResolved
nativeCatalog.ts  : + moss-tts-nano option (streaming/clones flags, 20 langs)
```

## Component design

### 1. Protocol + `NativeTtsClient` migration

- **`nativeProtocol.ts`**: add `TtsChunkMsg { type:'tts_chunk'; id; seq: number }` and `TtsDoneMsg { type:'tts_done'; id; totalSamples: number; generationTimeMs: number }`. `ReadyMsg` already carries `sampleRate?/backend?/device?/computeType?/rtf?/memoryBytes?/fallbackReason?`; add `streaming?: boolean` and `clones?: boolean` if absent.
- **`NativeTtsClient.init(model)`**: send `{type:'tts_init', model, id}`; return the full ready fields `{ sampleRate, loadTimeMs, backend?, device?, computeType?, rtf?, streaming, clones, memoryBytes?, fallbackReason? }` (today returns only `{sampleRate, loadTimeMs}`). Cache `streaming` on the instance.
- **`NativeTtsClient.generate(text, speed=1.0, onChunk?)`**: send `{type:'tts_generate', id, text, speed}`. Fork on the cached `streaming` flag:
  - one-shot: buffer the binary frame, pair with `result` → resolve `{ samples: Float32Array, sampleRate, generationTimeMs }`.
  - streaming: each `tts_chunk` (binary PCM + `{id, seq}`) → `onChunk(pcmFloat32, seq)`; resolve on `tts_done` (`totalSamples`, `generationTimeMs`).
  - PCM frames arrive as Int16@24k from the sidecar; the client decodes them to a `Float32Array` for both `onChunk(pcmFloat32, seq)` and the one-shot `samples` — matching the existing one-shot `TtsResult.samples: Float32Array` convention so the playback path (resample→int16, below) is byte-identical for both backends.
- **`NativeTtsClient.cancel(id)`**: send `{type:'tts_cancel', id}`.
- Keep `setReferenceVoice` as-is (Plan B uses it; it already sends a binary frame + `{type:'set_voice', sampleRate}` and the sidecar handler matches).

### 2. Resolved state + perf badge

- **`nativeModelStore`**: add `ttsLoading: boolean`, `ttsResolved: NativeResolved | null` (`{ model, device, rtf?, memoryBytes?, fallbackReason? }`), `setTtsLoading`, `setTtsResolved`, selector `useNativeTtsResolved()` — copied from the `asrResolved` shape.
- **`LocalNativeClient.connect()`**: set `ttsLoading` around `tts.init`; on success call `setTtsResolved({ model, device, rtf, memoryBytes, fallbackReason })` (today discarded).
- **`NativeModelManagementSection`**: change the TTS card's `resolvedForField` from `null` to the `ttsResolved` entry (matched by selected TTS model id), so the TTS card renders the same resolved tier badge as ASR/translate via the existing `resolvedTierState`/`actualNativeMemoryByDevice`/`formatMemMb` helpers (reused verbatim).

### 3. MOSS-Nano in the catalog

- **`nativeCatalog.ts`**: add a `moss-tts-nano` `NativeModelOption` (id `moss-tts-nano`, label "MOSS-TTS-Nano (multilingual)") surfaced for each of its 20 supported languages (zh/en/ja/ko/de/fr/es/pt/it/ru/ar/pl/cs/da/sv/el/tr/hu/fa/nl) — i.e. included by `nativeTtsVoices(tgt)`/`nativeTtsCards(tgt)` alongside piper voice(s) for that language. Carry capability flags `streaming: true`, `clones: true` on the option (read by the client/card; `clones` dormant in Plan A). `recommended` for languages lacking good piper coverage; `sortOrder` keeps piper the lightweight default and MOSS the multilingual high-quality option.

### 4. Full-parity playback in `LocalNativeClient.runJob`

Replace the whole-utterance one-shot with the WASM path's structure, generalized for one-shot vs streaming. Extract a per-sentence helper to avoid duplicating bookkeeping:

1. `splitSentences(translatedText, targetLanguage)`.
2. Per sentence, synthesize via `NativeTtsClient.generate`, branching on the resolved `streaming` flag:
   - streaming (MOSS): `generate(sentence, speed, onChunk)` — each `onChunk(pcm)` → `float32ToInt16(resampleFloat32(pcm, nativeSr, 24000))` → emit real-time `delta:{audio:int16}` immediately + accumulate.
   - one-shot (piper): `generate(sentence, speed)` → resample+int16 the whole sentence → emit one `delta:{audio:int16}`.
3. Resample/convert to Int16@24k (`resampleFloat32`+`float32ToInt16`; no-op when rates match, kept for symmetry).
4. Karaoke: push `assistantItem.formatted.audioSegments.push({ textEnd, audioEnd })` and update `audioTextEnd`, accumulating `audioEnd` (cumulative sample offset across sentences).
5. Replay (gated): `if (this.keepReplayAudio) this.appendItemAudio(assistantItem, int16Audio)`.
6. Real-time delta: `this.handlers.onConversationUpdated?.({ item: assistantItem, delta: { audio: int16Audio } })`.

On session **stop/interrupt**, call `NativeTtsClient.cancel(currentGenerateId)` to abort an in-flight MOSS stream. (The no-interruption rule governs *output*: cancel fires only on user-initiated stop, never mid-utterance from user audio.)

## Data flow (end to end)

select MOSS-Nano → `LocalNativeClient.connect` → `tts.init('moss-tts-nano')` → `ready{streaming:true, device, rtf,…}` → `setTtsResolved` (badge updates) → translation produces text → `runJob` splits sentences → per sentence `tts.generate(s, speed, onChunk)` → sidecar streams `tts_chunk` PCM → `onChunk` → resample/int16 → `delta:{audio}` → `ModernAudioPlayer` + karaoke segment + replay → `tts_done` → next sentence.

## Error handling

- `init` failure (sidecar `BackendLoadError` already degrades gpu→cpu and reports `fallbackReason`) surfaces via `ttsResolved.fallbackReason` in the badge; a hard init failure rejects `connect` like the ASR/translate stages.
- A `generate`/stream error (sidecar emits `{type:'error', id}`) rejects/ends that sentence's synthesis; `runJob` logs to `logStore` and continues (don't kill the session over one sentence) — matching the WASM client's per-utterance error tolerance.
- `tts_cancel` is best-effort; a late `tts_chunk` after cancel is ignored by id.

## Testing

| Test | Covers |
|---|---|
| `NativeTtsClient` (vitest) | `tts_init` + full `ready` parse; one-shot `tts_generate`→`result`+binary; streaming `tts_chunk`*→`onChunk`→`tts_done`; `tts_cancel`; error message handling (mock WS) |
| `nativeModelStore` (vitest) | `ttsLoading`/`ttsResolved` set + selector |
| `nativeCatalog` (vitest) | `moss-tts-nano` in `nativeTtsVoices`/`nativeTtsCards` for its langs with `streaming`/`clones`; ordering vs piper |
| `LocalNativeClient` (vitest) | per-sentence loop: split → one-shot (piper) emits N deltas + karaoke segments + replay (gated); streaming (MOSS, fake `onChunk`) emits per-chunk deltas; `setTtsResolved` on connect; `cancel` on stop |
| `NativeModelManagementSection` (vitest) | TTS card renders the resolved badge from `ttsResolved` (not null) |

Renderer tests run via `npx vitest run <paths>`.

## Dependencies / constraints

- Audio contract: Int16 PCM, 24 kHz, mono (the sidecar already emits this; the renderer resamples defensively).
- Reuse the existing `NativeResolved` interface + `resolvedTierState`/`actualNativeMemoryByDevice`/`formatMemMb`/`formatRtf` helpers — no new badge code.
- MOSS CUDA needs `onnxruntime-gpu` in the sidecar GPU pack; with the CPU pack MOSS resolves to CPU (real-time, RTF ~0.44) and the badge shows the CPU tier — no renderer change needed.

## Follow-up (Plan B)

Voice-clone UX: generalize `VoiceLibrarySection` into a capability-driven Voice section — sid + `voice_style.json` for Supertonic (existing) vs **reference-audio clip** for `clones`-capable models (MOSS): an `accept="audio/*"` upload (+ optional MediaRecorder capture, à la `NativeTtsProto`), a reference-audio store (new `voiceStorage` shape, not the style-JSON one), and `NativeTtsClient.setReferenceVoice(audio, sr)` called on `connect()` before generation; gated by the `clones` flag from `ready`.
