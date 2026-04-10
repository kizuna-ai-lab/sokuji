# Edge TTS Integration Design

## Summary

Integrate Microsoft Edge TTS as a free, high-quality online TTS option within the existing LOCAL_INFERENCE provider. Edge TTS connects to Bing's speech synthesis service via WebSocket, offering 400+ neural voices across 100+ languages. It sits alongside existing local TTS models (piper, matcha, etc.) as one more choice in the TTS model list.

Additionally, rename the LOCAL_INFERENCE provider display name from "Local (Offline)" to "Free" to reflect that not all components are offline.

## Background

The cloudflare-edge-tts project (github.com/DIYgod/cloudflare-edge-tts) demonstrates that Microsoft's Edge browser "Read Aloud" TTS service can be accessed via WebSocket using a fixed trusted client token. The protocol is straightforward: connect via WebSocket, send SSML, receive MP3 audio chunks.

Current local TTS models (piper, matcha) produce acceptable but noticeably synthetic speech. Edge TTS neural voices are significantly higher quality and support many more languages, at the cost of requiring an internet connection.

## Architecture

### Overview

```
User selects "Edge TTS" in TTS model dropdown
    |
    v
LocalInferenceClient.processPipelineJob()
    |
    v
TtsEngine.generateStream(text, voice, speed, onChunk)
    |
    v
edge-tts.worker.js
    |-- WebSocket → speech.platform.bing.com
    |-- Receives MP3 chunks
    |-- mpg123-decoder WASM: MP3 → Float32Array PCM
    |-- Sends audio-chunk messages back to main thread
    |
    v
LocalInferenceClient receives chunks
    |-- resample to 24kHz
    |-- convert to Int16
    |-- emit delta immediately
    |
    v
ModernAudioPlayer (existing, unchanged)
```

### Component 1: Edge TTS Core Library

**New file: `src/lib/edge-tts/edgeTts.ts`**

Adapted from cloudflare-edge-tts `tts.ts` for browser/Electron environments:

- Standard `new WebSocket(wss://...)` instead of CF Worker's `fetch` + HTTP upgrade
- `crypto.subtle.digest('SHA-256', ...)` for Sec-MS-GEC token generation (available in both browser and Electron)
- SSML construction, binary frame parsing, voice name normalization — reused as-is
- Exports `createAudioStream(input): ReadableStream<Uint8Array>` (MP3 chunks)

**New file: `src/lib/edge-tts/voiceList.ts`**

- `getVoices(): Promise<Voice[]>` — fetches full list via HTTPS, caches in memory for 24h
- `getVoicesByLocale(locale: string): Voice[]` — filters cached list by language
- Voice type: `{ Name, ShortName, Gender, Locale, FriendlyName }`

Key difference from cloudflare-edge-tts: WebSocket URL uses `wss://` scheme instead of `https://` since we use the standard WebSocket API rather than CF Worker's fetch-based upgrade.

### Component 2: Edge TTS Worker + Streaming MP3 Decode

**New file: `public/workers/edge-tts.worker.js`**

Classic JS worker (consistent with existing TTS workers).

**Dependencies:**
- `mpg123-decoder` npm package (WASM-based, ~150KB, streaming decode support)

**Message protocol:**

```
Main → Worker:
  { type: 'init' }
  { type: 'generate', text: string, voice: string, speed: number }
  { type: 'dispose' }

Worker → Main:
  { type: 'ready', numSpeakers: 0, sampleRate: 24000, loadTimeMs: number }
  { type: 'audio-chunk', samples: Float32Array, sampleRate: 24000 }
  { type: 'audio-done', generationTimeMs: number }
  { type: 'error', error: string }
  { type: 'disposed' }
```

**Flow on `generate`:**
1. Build SSML with voice name and speed (prosody rate)
2. Generate Sec-MS-GEC token
3. Open WebSocket to `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?...`
4. Send speech config message + SSML message
5. On each binary frame: extract MP3 body → `decoder.decode(chunk)` → post `audio-chunk` with Float32Array
6. On `turn.end` text message: post `audio-done`
7. Close WebSocket

### Component 3: TtsEngine Streaming Extension

**Modified file: `src/lib/local-inference/engine/TtsEngine.ts`**

New types and method:

```typescript
type AudioChunkCallback = (samples: Float32Array, sampleRate: number) => void;

async generateStream(
  text: string,
  sid: number,
  speed: number,
  lang?: string,
  onChunk: AudioChunkCallback
): Promise<{ generationTimeMs: number }>
```

Worker message handling extended with two new cases:
- `audio-chunk` → calls `onChunk` callback immediately
- `audio-done` → resolves the Promise

Engine routing in `init()`:
- `engine === 'edge-tts'` → `./workers/edge-tts.worker.js`
- `engine === 'piper-plus'` → `./workers/piper-plus-tts.worker.js`
- Other → `./workers/sherpa-onnx-tts.worker.js`

Edge TTS init skips `ModelManager.isModelReady()` check (no model files to download). The worker `init` message carries no file URLs.

Backward compatibility: `generate()` still works for Edge TTS by collecting all chunks internally and returning the concatenated result.

### Component 4: LocalInferenceClient Adaptation

**Modified file: `src/services/clients/LocalInferenceClient.ts`**

In `processPipelineJob`, the per-sentence TTS step branches:

```
if (ttsModel.engine === 'edge-tts') {
  await ttsEngine.generateStream(sentence, 0, speed, lang, (chunk) => {
    const resampled = resampleFloat32(chunk, 24000, 24000);
    const int16 = float32ToInt16(resampled);
    handlers.onConversationUpdated({ item, delta: { audio: int16 } });
    totalSamples += chunk.length;
  });
} else {
  // existing generate() path unchanged
}
```

Karaoke: `audioSegments[].audioEnd` computed after `generateStream` resolves, using accumulated `totalSamples`.

Error handling: WebSocket failure or decode error → worker sends `error` → skip sentence TTS, continue pipeline.

### Component 5: Model Registration + Voice Picker UI

**Model manifest (`modelManifest.ts`):**

```typescript
{
  id: 'edge-tts',
  type: 'tts',
  engine: 'edge-tts',
  languages: ['*'],
  numSpeakers: 0,
  variants: [],
  isCloudModel: true,  // new field — skips download checks
}
```

**TtsEngineType:** Add `'edge-tts'` to the union type.

**Voice picker UI (ProviderSpecificSettings):**

When `edge-tts` is selected as TTS model:
- Hide speaker ID slider
- Show voice dropdown, filtered by current translation target language
- Display format: `Nanami (Female)`, `Keita (Male)`, etc.
- Default: first available voice for the target language
- Auto-switch voice when target language changes
- Selected voice stored in settingsStore as `edgeTtsVoice: string`
- Speed slider retained (maps to SSML prosody rate)

**ModelManagementSection:**
- Edge TTS appears in TTS model list without download button or file size
- Displays an "Online" tag

### Component 6: Provider Rename

**Display name only** — internal enum stays `LOCAL_INFERENCE`:

- `getProviderDisplayName()`: return `'Free'` instead of `'Local (Offline)'`
- i18n translation files: update provider display name across all languages
- No changes to enum values, store keys, or internal references

**ModelManager download check:**
- `isProviderReady()`: when TTS model is `edge-tts` (`isCloudModel: true`), skip TTS download check
- ASR and Translation models still required to be downloaded

## New Dependencies

- `mpg123-decoder`: WASM-based MP3 decoder (~150KB), used in edge-tts worker for streaming decode

## Files Changed

| File | Change |
|------|--------|
| `src/lib/edge-tts/edgeTts.ts` | **New** — Core Edge TTS WebSocket + SSML logic |
| `src/lib/edge-tts/voiceList.ts` | **New** — Voice list fetch + cache + filter |
| `public/workers/edge-tts.worker.js` | **New** — Worker: WebSocket + MP3 decode + streaming |
| `src/lib/local-inference/engine/TtsEngine.ts` | **Modified** — Add `generateStream()`, edge-tts worker routing |
| `src/lib/local-inference/types.ts` | **Modified** — Add `audio-chunk`, `audio-done` message types |
| `src/lib/local-inference/modelManifest.ts` | **Modified** — Register edge-tts entry, add `isCloudModel` field |
| `src/services/clients/LocalInferenceClient.ts` | **Modified** — Branch to streaming TTS path for edge-tts |
| `src/components/Settings/sections/ProviderSpecificSettings.tsx` | **Modified** — Voice picker when edge-tts selected |
| `src/stores/settingsStore.ts` | **Modified** — Add `edgeTtsVoice` field |
| `src/types/Provider.ts` | **Modified** — Display name "Free" |
| `src/locales/*.json` | **Modified** — Provider display name translations |

## Not In Scope

- Edge TTS as a standalone provider (no free ASR/translation counterpart)
- SSML advanced features (emotion, style) — can be added later
- Offline fallback when Edge TTS fails (user explicitly chose it; error shown if network unavailable)
- Replacing existing local TTS models — they remain available
